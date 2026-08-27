//! Labels for the tray menu. The interface itself is translated in the
//! frontend (src/lib/i18n.ts); this is only what AppKit draws.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lang {
    En,
    Sk,
}

impl Lang {
    pub fn parse(value: &str) -> Self {
        match value.to_lowercase().as_str() {
            "sk" | "sks" | "sk-SK" => Self::Sk,
            _ => Self::En,
        }
    }

        pub fn toggle(self) -> &'static str {
        match self {
            Self::En => "Show / hide widget",
            Self::Sk => "Zobraziť / skryť widget",
        }
        }
        pub fn activity_monitor(self) -> &'static str {
        match self {
            Self::En => "Open Activity Monitor",
            Self::Sk => "Otvoriť Monitor aktivít",
        }
        }
        pub fn frequency(self) -> &'static str {
        match self {
            Self::En => "Sampling",
            Self::Sk => "Frekvencia odberu",
        }
        }
        pub fn network_meter(self) -> &'static str {
        match self {
            Self::En => "Network meter in menu bar",
            Self::Sk => "Meter siete v lište",
        }
        }
        pub fn settings(self) -> &'static str {
        match self {
            Self::En => "Settings…",
            Self::Sk => "Nastavenia…",
        }
        }
        pub fn place(self) -> &'static str {
        match self {
            Self::En => "Place on the grid",
            Self::Sk => "Umiestniť na mriežku",
        }
    }

    pub fn quit(self) -> &'static str {
        match self {
            Self::En => "Quit Flash Stats",
            Self::Sk => "Ukončiť Flash Stats",
        }
        }
        pub fn settings_window_title(self) -> &'static str {
        match self {
            Self::En => "Flash Stats Settings",
            Self::Sk => "Flash Stats — Nastavenia",
        }
        }
}
