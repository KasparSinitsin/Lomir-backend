const normalizePostalCode = (value) =>
  value === null || value === undefined
    ? ""
    : String(value).trim().toUpperCase();

const normalizeCountryCode = (value) => {
  if (!value) return null;

  const normalized = String(value).trim().toUpperCase();
  if (normalized === "DE" || normalized === "GERMANY" || normalized === "DEUTSCHLAND") {
    return "DE";
  }

  return normalized;
};

const BERLIN_POSTAL_CODE_DISTRICTS = {
  10115: "Mitte",
  10117: "Mitte",
  10119: "Mitte",
  10178: "Mitte",
  10179: "Mitte",
  10243: "Friedrichshain",
  10245: "Friedrichshain",
  10247: "Friedrichshain",
  10249: "Friedrichshain",
  10315: "Lichtenberg",
  10317: "Lichtenberg",
  10318: "Karlshorst",
  10319: "Friedrichsfelde",
  10365: "Lichtenberg",
  10367: "Lichtenberg",
  10369: "Lichtenberg",
  10405: "Prenzlauer Berg",
  10407: "Prenzlauer Berg",
  10409: "Prenzlauer Berg",
  10435: "Prenzlauer Berg",
  10437: "Prenzlauer Berg",
  10439: "Prenzlauer Berg",
  10551: "Moabit",
  10553: "Moabit",
  10555: "Moabit",
  10557: "Tiergarten",
  10559: "Moabit",
  10585: "Charlottenburg",
  10587: "Charlottenburg",
  10589: "Charlottenburg",
  10623: "Charlottenburg",
  10625: "Charlottenburg",
  10627: "Charlottenburg",
  10629: "Charlottenburg",
  10707: "Wilmersdorf",
  10709: "Wilmersdorf",
  10711: "Halensee",
  10713: "Wilmersdorf",
  10715: "Wilmersdorf",
  10717: "Wilmersdorf",
  10719: "Charlottenburg",
  10777: "Schöneberg",
  10779: "Schöneberg",
  10781: "Schöneberg",
  10783: "Schöneberg",
  10785: "Tiergarten",
  10787: "Schöneberg",
  10789: "Charlottenburg",
  10823: "Schöneberg",
  10825: "Schöneberg",
  10827: "Schöneberg",
  10829: "Schöneberg",
  10961: "Kreuzberg",
  10963: "Kreuzberg",
  10965: "Kreuzberg",
  10967: "Kreuzberg",
  10969: "Kreuzberg",
  10997: "Kreuzberg",
  10999: "Kreuzberg",
  12043: "Neukölln",
  12045: "Neukölln",
  12047: "Neukölln",
  12049: "Neukölln",
  12051: "Neukölln",
  12053: "Neukölln",
  12055: "Neukölln",
  12057: "Neukölln",
  12059: "Neukölln",
  12101: "Tempelhof",
  12103: "Tempelhof",
  12105: "Tempelhof",
  12107: "Tempelhof",
  12109: "Tempelhof",
  12157: "Steglitz",
  12159: "Friedenau",
  12161: "Friedenau",
  12163: "Steglitz",
  12165: "Steglitz",
  12167: "Steglitz",
  12169: "Steglitz",
  12203: "Lichterfelde",
  12205: "Lichterfelde",
  12207: "Lichterfelde",
  12209: "Lichterfelde",
  12247: "Lankwitz",
  12249: "Lankwitz",
  12277: "Marienfelde",
  12279: "Marienfelde",
  12305: "Lichtenrade",
  12307: "Lichtenrade",
  12309: "Lichtenrade",
  12347: "Britz",
  12349: "Buckow",
  12351: "Buckow",
  12353: "Buckow",
  12355: "Rudow",
  12357: "Rudow",
  12359: "Britz",
  12435: "Alt-Treptow",
  12437: "Baumschulenweg",
  12439: "Niederschöneweide",
  12459: "Oberschöneweide",
  12487: "Johannisthal",
  12489: "Adlershof",
  12524: "Altglienicke",
  12526: "Bohnsdorf",
  12527: "Grünau",
  12555: "Köpenick",
  12557: "Köpenick",
  12559: "Köpenick",
  12587: "Friedrichshagen",
  12589: "Rahnsdorf",
  12619: "Kaulsdorf",
  12621: "Kaulsdorf",
  12623: "Mahlsdorf",
  12627: "Hellersdorf",
  12629: "Hellersdorf",
  12679: "Marzahn",
  12681: "Marzahn",
  12683: "Biesdorf",
  12685: "Marzahn",
  12687: "Marzahn",
  12689: "Marzahn",
  13051: "Wartenberg",
  13053: "Hohenschönhausen",
  13055: "Hohenschönhausen",
  13057: "Hohenschönhausen",
  13059: "Wartenberg",
  13086: "Weißensee",
  13088: "Weißensee",
  13089: "Heinersdorf",
  13125: "Buch",
  13127: "Pankow",
  13129: "Blankenburg",
  13156: "Niederschönhausen",
  13158: "Rosenthal",
  13159: "Blankenfelde",
  13187: "Pankow",
  13189: "Pankow",
  13347: "Wedding",
  13349: "Wedding",
  13351: "Wedding",
  13353: "Wedding",
  13355: "Gesundbrunnen",
  13357: "Gesundbrunnen",
  13359: "Gesundbrunnen",
  13403: "Reinickendorf",
  13405: "Reinickendorf",
  13407: "Reinickendorf",
  13409: "Reinickendorf",
  13435: "Märkisches Viertel",
  13437: "Wittenau",
  13439: "Märkisches Viertel",
  13465: "Frohnau",
  13467: "Hermsdorf",
  13469: "Waidmannslust",
  13503: "Heiligensee",
  13505: "Konradshöhe",
  13507: "Tegel",
  13509: "Tegel",
  13581: "Spandau",
  13583: "Spandau",
  13585: "Spandau",
  13587: "Hakenfelde",
  13589: "Falkenhagener Feld",
  13591: "Staaken",
  13593: "Wilhelmstadt",
  13595: "Wilhelmstadt",
  13597: "Spandau",
  13599: "Haselhorst",
  13627: "Charlottenburg",
  13629: "Siemensstadt",
  14050: "Westend",
  14052: "Westend",
  14053: "Westend",
  14055: "Westend",
  14057: "Charlottenburg",
  14059: "Charlottenburg",
  14089: "Kladow",
  14109: "Wannsee",
  14129: "Nikolassee",
  14163: "Zehlendorf",
  14165: "Zehlendorf",
  14167: "Zehlendorf",
  14169: "Zehlendorf",
  14193: "Grunewald",
  14195: "Dahlem",
  14197: "Wilmersdorf",
  14199: "Wilmersdorf",
};

const FRANKFURT_POSTAL_CODE_DISTRICTS = {
  60308: "Westend-Süd",
  60310: "Innenstadt",
  60311: "Innenstadt",
  60313: "Innenstadt",
  60329: "Bahnhofsviertel",
  60389: "Nordend-Ost",
  65933: "Griesheim",
  65934: "Höchst",
  65936: "Nied",
};

function deriveLocationFromPostalCode(postalCode, country) {
  const code = normalizePostalCode(postalCode);
  if (!code) return {};

  const countryCode = normalizeCountryCode(country);
  if (countryCode && countryCode !== "DE") return {};

  const berlinDistrict = BERLIN_POSTAL_CODE_DISTRICTS[code];
  if (berlinDistrict) {
    return {
      city: "Berlin",
      state: "Berlin",
      country: "Germany",
      district: berlinDistrict,
    };
  }

  if (/^10\d{3}$|^11\d{3}$|^12\d{3}$|^13\d{3}$|^14[01]\d{2}$/.test(code)) {
    return { city: "Berlin", state: "Berlin", country: "Germany" };
  }

  const frankfurtDistrict = FRANKFURT_POSTAL_CODE_DISTRICTS[code];
  if (frankfurtDistrict) {
    return {
      city: "Frankfurt am Main",
      state: "Hessen",
      country: "Germany",
      district: frankfurtDistrict,
    };
  }

  if (/^60\d{3}$|^65\d{3}$/.test(code)) {
    return { city: "Frankfurt am Main", state: "Hessen", country: "Germany" };
  }

  return {};
}

module.exports = {
  deriveLocationFromPostalCode,
};
