// The bundled fonts' files (design D294), each a file of its own the build
// emits beside the scripts, fetched only when its font is chosen: the four
// subsets AstroTime ships of each (latin, latin-ext, cyrillic, cyrillic-ext,
// with Google Fonts' ranges), a variable font narrowed to the weights the
// type scale uses (400 to 600, design D134), PT Sans in its two weights.
// Made by scripts/fonts.sh; each font's licence is beside its files (OFL.txt).

import interLatin from "./inter/latin.woff2?no-inline";
import interLatinExt from "./inter/latin-ext.woff2?no-inline";
import interCyrillic from "./inter/cyrillic.woff2?no-inline";
import interCyrillicExt from "./inter/cyrillic-ext.woff2?no-inline";
import robotoLatin from "./roboto/latin.woff2?no-inline";
import robotoLatinExt from "./roboto/latin-ext.woff2?no-inline";
import robotoCyrillic from "./roboto/cyrillic.woff2?no-inline";
import robotoCyrillicExt from "./roboto/cyrillic-ext.woff2?no-inline";
import notoSansLatin from "./noto-sans/latin.woff2?no-inline";
import notoSansLatinExt from "./noto-sans/latin-ext.woff2?no-inline";
import notoSansCyrillic from "./noto-sans/cyrillic.woff2?no-inline";
import notoSansCyrillicExt from "./noto-sans/cyrillic-ext.woff2?no-inline";
import nunitoLatin from "./nunito/latin.woff2?no-inline";
import nunitoLatinExt from "./nunito/latin-ext.woff2?no-inline";
import nunitoCyrillic from "./nunito/cyrillic.woff2?no-inline";
import nunitoCyrillicExt from "./nunito/cyrillic-ext.woff2?no-inline";
import literataLatin from "./literata/latin.woff2?no-inline";
import literataLatinExt from "./literata/latin-ext.woff2?no-inline";
import literataCyrillic from "./literata/cyrillic.woff2?no-inline";
import literataCyrillicExt from "./literata/cyrillic-ext.woff2?no-inline";
import jetbrainsMonoLatin from "./jetbrains-mono/latin.woff2?no-inline";
import jetbrainsMonoLatinExt from "./jetbrains-mono/latin-ext.woff2?no-inline";
import jetbrainsMonoCyrillic from "./jetbrains-mono/cyrillic.woff2?no-inline";
import jetbrainsMonoCyrillicExt from "./jetbrains-mono/cyrillic-ext.woff2?no-inline";
import ptSansLatin400 from "./pt-sans/latin-400.woff2?no-inline";
import ptSansLatin700 from "./pt-sans/latin-700.woff2?no-inline";
import ptSansLatinExt400 from "./pt-sans/latin-ext-400.woff2?no-inline";
import ptSansLatinExt700 from "./pt-sans/latin-ext-700.woff2?no-inline";
import ptSansCyrillic400 from "./pt-sans/cyrillic-400.woff2?no-inline";
import ptSansCyrillic700 from "./pt-sans/cyrillic-700.woff2?no-inline";
import ptSansCyrillicExt400 from "./pt-sans/cyrillic-ext-400.woff2?no-inline";
import ptSansCyrillicExt700 from "./pt-sans/cyrillic-ext-700.woff2?no-inline";
import { FAMILIES, type BundledFont } from "./index.ts";

type Subset = "latin" | "latin-ext" | "cyrillic" | "cyrillic-ext";

const RANGES: Readonly<Record<Subset, string>> = {
  latin:
    "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  "latin-ext":
    "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
  cyrillic: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
  "cyrillic-ext": "U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F",
};

/** A file of a font: its URL, its subset, and the weights it draws (a range for a variable font). */
interface File {
  readonly url: string;
  readonly subset: Subset;
  readonly weight: string;
}

const variable = (
  latin: string,
  latinExt: string,
  cyrillic: string,
  cyrillicExt: string,
): readonly File[] => [
  { url: latin, subset: "latin", weight: "400 600" },
  { url: latinExt, subset: "latin-ext", weight: "400 600" },
  { url: cyrillic, subset: "cyrillic", weight: "400 600" },
  { url: cyrillicExt, subset: "cyrillic-ext", weight: "400 600" },
];

const FILES: Readonly<Record<BundledFont, readonly File[]>> = {
  inter: variable(interLatin, interLatinExt, interCyrillic, interCyrillicExt),
  roboto: variable(robotoLatin, robotoLatinExt, robotoCyrillic, robotoCyrillicExt),
  "noto-sans": variable(notoSansLatin, notoSansLatinExt, notoSansCyrillic, notoSansCyrillicExt),
  nunito: variable(nunitoLatin, nunitoLatinExt, nunitoCyrillic, nunitoCyrillicExt),
  literata: variable(literataLatin, literataLatinExt, literataCyrillic, literataCyrillicExt),
  "jetbrains-mono": variable(
    jetbrainsMonoLatin,
    jetbrainsMonoLatinExt,
    jetbrainsMonoCyrillic,
    jetbrainsMonoCyrillicExt,
  ),
  "pt-sans": [
    { url: ptSansLatin400, subset: "latin", weight: "400" },
    { url: ptSansLatin700, subset: "latin", weight: "700" },
    { url: ptSansLatinExt400, subset: "latin-ext", weight: "400" },
    { url: ptSansLatinExt700, subset: "latin-ext", weight: "700" },
    { url: ptSansCyrillic400, subset: "cyrillic", weight: "400" },
    { url: ptSansCyrillic700, subset: "cyrillic", weight: "700" },
    { url: ptSansCyrillicExt400, subset: "cyrillic-ext", weight: "400" },
    { url: ptSansCyrillicExt700, subset: "cyrillic-ext", weight: "700" },
  ],
};

/** The faces of `font`, not loaded yet. */
export function facesOf(font: BundledFont): FontFace[] {
  return FILES[font].map(
    ({ url, subset, weight }) =>
      new FontFace(FAMILIES[font].name, `url("${url}") format("woff2")`, {
        weight,
        unicodeRange: RANGES[subset],
        display: "swap",
      }),
  );
}
