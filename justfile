default: host-site

test: test-rust test-ts test-go test-python

test-rust:
    cargo test --manifest-path rust/Cargo.toml --all-features

test-ts:
    npm --prefix ts install
    npm --prefix ts run check
    npm --prefix ts test
    npm --prefix ts run build

test-go:
    cd go && go vet ./... && go test ./...

test-python:
    cd python && uv run pytest && uv run mypy

clippy:
    cargo clippy --manifest-path rust/Cargo.toml --all-features --all-targets -- -D warnings

# Releases one package by tagging the current commit as <package>/v<version>
# and pushing the tag; .github/workflows/release.yml then tests and publishes
# it. Bump the version in Cargo.toml, package.json or pyproject.toml and commit
# first. Go has no manifest version, so pass it: `just release go 0.1.0`.
release package version="":
    #!/usr/bin/env bash
    set -euo pipefail
    case "{{package}}" in
      rust) version=$(cargo metadata --manifest-path rust/Cargo.toml --format-version 1 --no-deps \
              | jq -r '.packages[] | select(.name == "hypereffect") | .version') ;;
      ts) version=$(node -p "require('./ts/package.json').version") ;;
      python) version=$(uv version --project python --short) ;;
      go) version="{{version}}"; [ -n "$version" ] || { echo "usage: just release go <version>"; exit 1; } ;;
      *) echo "unknown package {{package}}: rust, ts, python or go"; exit 1 ;;
    esac
    if [ -n "{{version}}" ] && [ "{{version}}" != "$version" ]; then
      echo "{{package}} is at $version, not {{version}}"; exit 1
    fi
    if [ -n "$(git status --porcelain)" ]; then
      echo "commit your changes first"; exit 1
    fi
    tag="{{package}}/v$version"
    git tag "$tag"
    git push origin "$tag"
    echo "pushed $tag"

host-site:
    python -m http.server -d site 9090

build-demo:
    #!/usr/bin/env bash
    # Builds the demo servers to WebAssembly and copies them, with the compiled
    # TypeScript library, into site/demo so the site can be served as static files.
    demos="todos qr monitor hotel"
    pkgs=""
    for d in $demos; do pkgs="$pkgs -p demo-$d"; done
    
    # shellcheck disable=SC2086
    cd rust
    cargo build --release --target wasm32-unknown-unknown $pkgs
    cd ..
    
    target=$(cargo metadata --manifest-path rust/Cargo.toml --format-version 1 --no-deps \
      | grep -o '"target_directory":"[^"]*"' | cut -d'"' -f4)
    
    mkdir -p site/demo/wasm
    for d in $demos; do
      cp "$target/wasm32-unknown-unknown/release/$d.wasm" site/demo/wasm/
    done
    
    npm --prefix ts install
    npm --prefix ts run build
    rm -rf site/demo/lib
    mkdir -p site/demo/lib
    cp ts/dist/*.js site/demo/lib/
    
    echo "Built site/demo. Serve it with: python -m http.server -d site"

fmt:
    npx --yes prettier@3 --write "site/**/*.{html,css}"

build-og:
    for n in plant expense todos; do \
      chromium --headless --hide-scrollbars --force-device-scale-factor=1 --window-size=1200,630 \
        --screenshot=site/og-$n.png "file://$PWD/site/og/$n.html"; \
    done
