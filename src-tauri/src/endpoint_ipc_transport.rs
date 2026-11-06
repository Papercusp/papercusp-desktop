//! Shared endpoint IPC transport for the desktop shell and PUI.
//! Keep endpoint selection in one place; framing and call routing stay with each client.

use std::path::Path;
use tokio::io::{AsyncRead, AsyncWrite};

/// Runtime-selected transport for the endpoint-IPC stream.
///
/// A Unix domain socket, a Windows named pipe, and a loopback TCP connection
/// all satisfy `AsyncRead + AsyncWrite`, but they are distinct concrete types
/// — and on Windows the choice can NOT be made at compile time: the sidecar
/// runs inside WSL2, where it is reachable from the Windows host only over
/// loopback TCP (a Unix socket it creates is invisible to the host, and it
/// can't create a `\\.\pipe\` named pipe), so a Windows build must be able to
/// speak EITHER a named pipe (a hypothetical native sidecar) OR TCP (the real
/// WSL2 sidecar). The variant is therefore chosen at CONNECT time from the
/// discovered endpoint string. TCP is what finally lights up the `/api`
/// connection-cap bypass on Windows — WI-3395 / fact
/// `windows-ipc-bypass-off-wsl2`. Three places classify this same string and
/// must stay in lockstep: `parse_endpoint`
/// (libs/generic/ipc-endpoint-server/src/server.ts), the
/// `endpoint_ipc_socket_path_supported_for_target` guard (main.rs), and
/// `parse_tcp_endpoint` below.
pub(crate) enum IpcStream {
    #[cfg(unix)]
    Unix(tokio::net::UnixStream),
    #[cfg(windows)]
    Pipe(tokio::net::windows::named_pipe::NamedPipeClient),
    Tcp(tokio::net::TcpStream),
}

// All three inner transports are `Unpin`, so the enum is `Unpin` and
// `Pin::get_mut` + re-pinning each `&mut inner` is sound. We just forward each
// poll to whichever variant is live.
impl AsyncRead for IpcStream {
    fn poll_read(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match self.get_mut() {
            #[cfg(unix)]
            IpcStream::Unix(s) => std::pin::Pin::new(s).poll_read(cx, buf),
            #[cfg(windows)]
            IpcStream::Pipe(s) => std::pin::Pin::new(s).poll_read(cx, buf),
            IpcStream::Tcp(s) => std::pin::Pin::new(s).poll_read(cx, buf),
        }
    }
}

impl AsyncWrite for IpcStream {
    fn poll_write(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
        buf: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        match self.get_mut() {
            #[cfg(unix)]
            IpcStream::Unix(s) => std::pin::Pin::new(s).poll_write(cx, buf),
            #[cfg(windows)]
            IpcStream::Pipe(s) => std::pin::Pin::new(s).poll_write(cx, buf),
            IpcStream::Tcp(s) => std::pin::Pin::new(s).poll_write(cx, buf),
        }
    }

    fn poll_flush(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match self.get_mut() {
            #[cfg(unix)]
            IpcStream::Unix(s) => std::pin::Pin::new(s).poll_flush(cx),
            #[cfg(windows)]
            IpcStream::Pipe(s) => std::pin::Pin::new(s).poll_flush(cx),
            IpcStream::Tcp(s) => std::pin::Pin::new(s).poll_flush(cx),
        }
    }

    fn poll_shutdown(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        match self.get_mut() {
            #[cfg(unix)]
            IpcStream::Unix(s) => std::pin::Pin::new(s).poll_shutdown(cx),
            #[cfg(windows)]
            IpcStream::Pipe(s) => std::pin::Pin::new(s).poll_shutdown(cx),
            IpcStream::Tcp(s) => std::pin::Pin::new(s).poll_shutdown(cx),
        }
    }
}

/// Classify the discovered endpoint string: `Some("host:port")` for a
/// `tcp://host:port` address, else `None` (a Unix-socket / named-pipe path).
/// Mirrors `parse_endpoint` (Node) and is shared with the main.rs target guard
/// so all endpoint-IPC call sites use the same strict syntax. Handles a
/// bracketed IPv6 literal too (`tcp://[::1]:8080` → `[::1]:8080`), which
/// `ToSocketAddrs` for `&str` parses natively.
pub(crate) fn is_tcp_endpoint(socket: &str) -> bool {
    parse_tcp_endpoint(socket).is_some()
}

pub(crate) fn parse_tcp_endpoint(socket: &str) -> Option<&str> {
    let trimmed = socket.trim();
    let hostport = trimmed.strip_prefix("tcp://")?;

    // Keep this grammar aligned with server.ts' parseEndpoint regex:
    // `tcp://[host]:port` or `tcp://host:port`, with a numeric port. The
    // bracketed form may contain colons (IPv6); the unbracketed form may not.
    let (host, port, bracketed_host) = if let Some(bracketed) = hostport.strip_prefix('[') {
        let close = bracketed.find(']')?;
        let host = &bracketed[..close];
        let port = bracketed[close + 1..].strip_prefix(':')?;
        (host, port, true)
    } else {
        let (host, port) = hostport.rsplit_once(':')?;
        (host, port, false)
    };

    if host.is_empty()
        || (!bracketed_host
            && (host.contains('/')
                || host.contains(':')
                || host.contains('[')
                || host.contains(']')))
        || port.is_empty()
        || !port.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }

    Some(hostport)
}

/// Dial the endpoint at `socket_path` and return the opened stream. A
/// `tcp://host:port` path is dialed as loopback TCP on ANY host OS — that is
/// how the Windows host reaches the WSL2 sidecar (WI-3395). Otherwise the
/// platform transport is used: a Unix domain socket on unix, a named pipe on
/// Windows.
pub(crate) async fn connect_stream(path: &Path) -> std::io::Result<IpcStream> {
    if let Some(hostport) = path.to_str().and_then(parse_tcp_endpoint) {
        let stream = tokio::net::TcpStream::connect(hostport).await?;
        // IPC frames are small + latency-sensitive (a REQUEST then a stream of
        // events); disable Nagle to match the Unix-socket / named-pipe
        // transports, which have no such coalescing delay.
        let _ = stream.set_nodelay(true);
        return Ok(IpcStream::Tcp(stream));
    }
    #[cfg(unix)]
    {
        Ok(IpcStream::Unix(
            tokio::net::UnixStream::connect(path).await?,
        ))
    }
    #[cfg(windows)]
    {
        use tokio::net::windows::named_pipe::ClientOptions;
        Ok(IpcStream::Pipe(
            ClientOptions::new().open(path.as_os_str())?,
        ))
    }
}
