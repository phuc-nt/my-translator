fn main() {
    // screencapturekit crate requires linking to libswift_Concurrency.dylib
    // On macOS 15+, it's in the dyld shared cache at /usr/lib/swift/
    // The crate's build script adds @rpath references, but we need to ensure
    // the linker can resolve them. Adding /usr/lib/swift as rpath covers modern macOS.
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");

    // Android requires libc++_shared.so for C++ symbols (e.g. __cxa_pure_virtual from oboe/cpal).
    // CARGO_TARGET_*_RUSTFLAGS set by Tauri CLI overrides config.toml so we use build.rs instead.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-lib=c++_shared");
    }

    tauri_build::build()
}
