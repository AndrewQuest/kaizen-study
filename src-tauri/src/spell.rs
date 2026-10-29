//! Offline spell checking with Hunspell dictionaries (LibreOffice/Firefox format) through
//! `spellbook`. With several languages active, a word is correct if any dictionary accepts it.

use spellbook::Dictionary;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

/// (code, .aff, .dic) — embedded so the app works without internet or extra files.
const DICTIONARIES: &[(&str, &str, &str)] = &[
    ("es", include_str!("../dictionaries/es.aff"), include_str!("../dictionaries/es.dic")),
    ("en", include_str!("../dictionaries/en.aff"), include_str!("../dictionaries/en.dic")),
];

pub const LANGUAGES: &[&str] = &["es", "en"];

static LOADED: OnceLock<HashMap<&'static str, Dictionary>> = OnceLock::new();

/// Parses the dictionaries once (≈ a few hundred ms); called early on a background thread.
pub fn dictionaries() -> &'static HashMap<&'static str, Dictionary> {
    LOADED.get_or_init(|| {
        DICTIONARIES
            .iter()
            .filter_map(|(code, aff, dic)| match Dictionary::new(aff, dic) {
                Ok(d) => Some((*code, d)),
                Err(err) => {
                    eprintln!("No se pudo cargar el diccionario {code}: {err}");
                    None
                }
            })
            .collect()
    })
}

fn active<'a>(langs: &'a [String]) -> impl Iterator<Item = &'static Dictionary> + 'a {
    langs.iter().filter_map(|l| dictionaries().get(l.as_str()))
}

/// Returns, for each word, whether it is spelled correctly in at least one active language
/// or is in the personal dictionary (case-insensitive).
pub fn check(words: &[String], langs: &[String], personal: &HashSet<String>) -> Vec<bool> {
    words
        .iter()
        .map(|w| {
            let word = w.trim_matches(|c| c == '\'' || c == '’');
            word.is_empty()
                || personal.contains(&word.to_lowercase())
                || active(langs).any(|d| d.check(word))
        })
        .collect()
}

pub fn suggest(word: &str, langs: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for dict in active(langs) {
        let mut found = Vec::new();
        dict.suggest(word, &mut found);
        for s in found {
            if seen.insert(s.clone()) {
                out.push(s);
            }
        }
    }
    out.truncate(8);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn langs(l: &[&str]) -> Vec<String> {
        l.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn checks_spanish_english_and_both() {
        let none = HashSet::new();
        let words: Vec<String> = ["derivada", "función", "Hola", "dérivada", "because", "becuase"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(check(&words, &langs(&["es"]), &none), [true, true, true, false, false, false]);
        assert_eq!(check(&words, &langs(&["en"]), &none)[4], true);
        assert_eq!(check(&words, &langs(&["es", "en"]), &none), [true, true, true, false, true, false]);
    }

    #[test]
    fn personal_dictionary_and_suggestions() {
        let mut personal = HashSet::new();
        personal.insert("kaizen".to_string());
        assert_eq!(check(&["Kaizen".into()], &langs(&["es"]), &personal), [true]);
        assert!(suggest("funcion", &langs(&["es"])).contains(&"función".to_string()));
        assert!(suggest("becuase", &langs(&["en"])).contains(&"because".to_string()));
    }
}
