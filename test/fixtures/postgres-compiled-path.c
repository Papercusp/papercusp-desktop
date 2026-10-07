/* Portions Copyright (c) 1996-2026, The PostgreSQL Global Development Group.
 * Portions Copyright (c) 1994, The Regents of the University of California.
 *
 * Permission to use, copy, modify, and distribute this software and its
 * documentation for any purpose, without fee, and without a written agreement
 * is hereby granted, provided that the above copyright notice and this
 * paragraph and the following two paragraphs appear in all copies.
 *
 * IN NO EVENT SHALL THE UNIVERSITY OF CALIFORNIA BE LIABLE TO ANY PARTY FOR
 * DIRECT, INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES, INCLUDING
 * LOST PROFITS, ARISING OUT OF THE USE OF THIS SOFTWARE AND ITS DOCUMENTATION,
 * EVEN IF THE UNIVERSITY OF CALIFORNIA HAS BEEN ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 *
 * THE UNIVERSITY OF CALIFORNIA SPECIFICALLY DISCLAIMS ANY WARRANTIES,
 * INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY
 * AND FITNESS FOR A PARTICULAR PURPOSE. THE SOFTWARE PROVIDED HEREUNDER IS
 * ON AN "AS IS" BASIS, AND THE UNIVERSITY OF CALIFORNIA HAS NO OBLIGATIONS TO
 * PROVIDE MAINTENANCE, SUPPORT, UPDATES, ENHANCEMENTS, OR MODIFICATIONS.
 */
/* PostgreSQL REL_18_6 src/port/path.c make_relative_path, fixture of its
 * optimized writer. PostgreSQL license. Helpers here cover the absolute,
 * canonical fixture paths only; the algorithm and constant arguments are
 * retained so -O2 can fold strlen(PGBINDIR), just as the measured bottle did.
 */
#define _XOPEN_SOURCE 700
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#define MAXPGPATH 4096
#define IS_DIR_SEP(c) ((c) == '/')
#ifndef PREFIX
#define PREFIX "/usr/local"
#endif
#define PGBINDIR PREFIX "/Cellar/postgresql@18/18.6/bin"
#define PGSHAREDIR PREFIX "/share/postgresql@18"
#define PKGLIBDIR PREFIX "/lib/postgresql@18"
static void trim_directory(char *p) { char *s = strrchr(p, '/'); if (s) *s = 0; }
static void trim_trailing_separator(char *p) { size_t n = strlen(p); while (n > 1 && p[n-1] == '/') p[--n] = 0; }
static void canonicalize_path(char *p) { (void)p; }
static void join_path_components(char *out, const char *head, const char *tail) {
    char tmp[MAXPGPATH]; snprintf(tmp, sizeof(tmp), "%s/%s", head, tail); strcpy(out, tmp);
}
static size_t strlcpy(char *out, const char *in, size_t size) {
    size_t n = strlen(in); snprintf(out, size, "%s", in); return n;
}
static int dir_strcmp(const char *a, const char *b) { return strcmp(a,b); }
static void
make_relative_path(char *ret_path, const char *target_path,
                   const char *bin_path, const char *my_exec_path)
{
    int prefix_len, tail_start, tail_len, i;
    prefix_len = 0;
    for (i = 0; target_path[i] && bin_path[i]; i++) {
        if (IS_DIR_SEP(target_path[i]) && IS_DIR_SEP(bin_path[i]))
            prefix_len = i + 1;
        else if (target_path[i] != bin_path[i])
            break;
    }
    if (prefix_len == 0) goto no_match;
    tail_len = strlen(bin_path) - prefix_len;
    strlcpy(ret_path, my_exec_path, MAXPGPATH);
    trim_directory(ret_path);
    canonicalize_path(ret_path);
    tail_start = (int)strlen(ret_path) - tail_len;
    if (tail_start > 0 && IS_DIR_SEP(ret_path[tail_start - 1]) &&
        dir_strcmp(ret_path + tail_start, bin_path + prefix_len) == 0) {
        ret_path[tail_start] = '\0';
        trim_trailing_separator(ret_path);
        join_path_components(ret_path, ret_path, target_path + prefix_len);
        canonicalize_path(ret_path);
        return;
    }
no_match:
    strlcpy(ret_path, target_path, MAXPGPATH);
    canonicalize_path(ret_path);
}
int main(int argc, char **argv) {
    char executable[MAXPGPATH], share[MAXPGPATH], lib[MAXPGPATH];
    (void)argc;
    if (!realpath(argv[0], executable)) return 2;
    make_relative_path(share, PGSHAREDIR, PGBINDIR, executable);
    make_relative_path(lib, PKGLIBDIR, PGBINDIR, executable);
    printf("%s\n%s\n", share, lib);
    return 0;
}
