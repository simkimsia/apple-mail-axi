# bench/

Benchmark for this AXI tool, in the axi-bench layout. Copy this directory into
`<vendor>-axi/bench/` and replace the example tasks.

```
bench/
  tasks.yaml              tasks: prompt, category, verifier, oracle (authored here)
  conditions.yaml         tool surfaces to compare (each becomes one Harbor agent)
  environment/Dockerfile  installs every surface under test, pinned
  fixtures/               create.sh / destroy.sh for the live-service fixture the tasks read
  generated/              Harbor task dirs + dataset.toml from `axi-bench generate` (git-ignored)
  published-results/      rendered report + every trajectory of a published run
```

Comparisons are between conditions for this vendor only. See axi-bench
`docs/methodology.md` before publishing, and `docs/examples/generated-task/`
for what the generator emits.
