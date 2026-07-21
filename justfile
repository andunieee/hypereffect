default: host-site

test: test-rust test-js

test-rust:
    cargo test --manifest-path rust/Cargo.toml --all-features

test-js:
    npm --prefix js install
    npm --prefix js test

clippy:
    cargo clippy --manifest-path rust/Cargo.toml --all-features --all-targets -- -D warnings

host-site:
    python -m http.server -d site 9090

build-demo:
    #!/usr/bin/env bash
    # Builds the demo servers to WebAssembly and copies them, with the JavaScript
    # library, into site/demo so the site can be served as static files.
    demos="psu import todos"
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
    
    rm -rf site/demo/lib
    cp -r js/src site/demo/lib
    
    echo "Built site/demo. Serve it with: python -m http.server -d site"
