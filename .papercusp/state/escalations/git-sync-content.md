---
authority: null
body_embedding_mode: "gemma"
body_tsv: "'1':37A,49A '1788953395939':43A '698':26A 'auto':57A 'auto-commit':56A 'bash':20A 'bin/release-local.sh':14A 'broken':50A 'clean':62A 'commit':58A 'consecut':33A 'content':5A,34A,64A 'content-fix':63A 'detail':44A 'detector':15A 'dispatch':66A 'emit':41A 'error':6A,19A,23A,28A,35A 'exclud':53A 'fals':40A 'file':10A,13A,51A 'fixer':65A 'git':3A,46A 'git-sync':45A 'git-sync-content-error':2A 'har':7A 'human':39A 'kind':1A 'line':25A 'n':21A 'near':29A 'need':38A 'papercusp/papercusp-desktop':9A 'process.exit':32A 'quarantin':48A 'scope':11A 'shell':17A,69A 'shell-syntax':16A,68A 'slug':8A 'stage':60A 'stay':61A 'superproject':12A 'superproject/bin/release-local.sh':67A 'sync':4A,47A 'syntax':18A,22A,27A,70A 'tick':36A 'token':31A 'unexpect':30A"
escalation: "{\"kind\":\"git-sync-content-error\",\"harness_slug\":\"papercusp/papercusp-desktop\",\"files\":[{\"scope\":\"superproject\",\"file\":\"bin/release-local.sh\",\"detector\":\"shell-syntax\",\"error\":\"bash -n syntax error at line 698: syntax error near unexpected token `process.exit'\"}],\"consecutive_content_error_ticks\":1,\"needs_human\":false,\"emitted_at\":1788953395939,\"detail\":\"git-sync quarantined 1 broken file(s) (excluded from the auto-commit so staging stays clean); content-fixer dispatched: superproject/bin/release-local.sh [shell-syntax].\"}"
mtime_ms: 1788953395939
phase: "git-sync-content"
risk_tier: null
supervisor_notes: null
---


