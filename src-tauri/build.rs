fn main() {
    #[cfg(target_os = "macos")]
    {
        // Since macOS 14 the name of the joined Wi-Fi network counts as
        // location data. CoreLocation is linked to ask for that access and
        // CoreWLAN to read the name inside this process, which is the only
        // place the grant applies. See sensors::location and sensors::wifi.
        println!("cargo:rustc-link-lib=framework=CoreLocation");
        println!("cargo:rustc-link-lib=framework=CoreWLAN");
        println!("cargo:rerun-if-changed=Info.plist");
    }
    tauri_build::build()
}
