import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import pt from "./locales/pt";
import en from "./locales/en";

const LANG_KEY = "gesaia_lang";
const savedLang = typeof localStorage !== "undefined" ? (localStorage.getItem(LANG_KEY) ?? "pt") : "pt";

i18n.use(initReactI18next).init({
  resources: {
    pt: { translation: pt },
    en: { translation: en },
  },
  lng: savedLang,
  fallbackLng: "pt",
  interpolation: {
    escapeValue: false,
  },
});

export default i18n;
