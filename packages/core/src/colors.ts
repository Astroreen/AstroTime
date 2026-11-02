// RFC 7986 `COLOR` and the exact colour beside it (docs/plans/foundation.md#D174).
// `COLOR` takes a CSS3 colour name, not a hex: a colour of AstroTime's own is
// written as the nearest name, as Nextcloud Calendar writes one, with its hex
// in `X-ASTROTIME-COLOR`, which AstroTime reads first while `COLOR` is still
// that name. Another client that changes `COLOR` wins: the hex no longer
// matches it, so it is not read.

/** CSS3's named colours (CSS Color Module Level 3, §4.3), each name and its six hex digits; of two spellings (`gray`, `grey`; `aqua`, `cyan`) the first. */
const NAMED =
  "alicebluef0f8ff,antiquewhitefaebd7,aqua00ffff,aquamarine7fffd4,azuref0ffff,beigef5f5dc,bisqueffe4c4,black000000,blanchedalmondffebcd,blue0000ff,blueviolet8a2be2,browna52a2a,burlywooddeb887,cadetblue5f9ea0,chartreuse7fff00,chocolated2691e,coralff7f50,cornflowerblue6495ed,cornsilkfff8dc,crimsondc143c,darkblue00008b,darkcyan008b8b,darkgoldenrodb8860b,darkgraya9a9a9,darkgreen006400,darkkhakibdb76b,darkmagenta8b008b,darkolivegreen556b2f,darkorangeff8c00,darkorchid9932cc,darkred8b0000,darksalmone9967a,darkseagreen8fbc8f,darkslateblue483d8b,darkslategray2f4f4f,darkturquoise00ced1,darkviolet9400d3,deeppinkff1493,deepskyblue00bfff,dimgray696969,dodgerblue1e90ff,firebrickb22222,floralwhitefffaf0,forestgreen228b22,fuchsiaff00ff,gainsborodcdcdc,ghostwhitef8f8ff,goldffd700,goldenroddaa520,gray808080,green008000,greenyellowadff2f,honeydewf0fff0,hotpinkff69b4,indianredcd5c5c,indigo4b0082,ivoryfffff0,khakif0e68c,lavendere6e6fa,lavenderblushfff0f5,lawngreen7cfc00,lemonchiffonfffacd,lightblueadd8e6,lightcoralf08080,lightcyane0ffff,lightgoldenrodyellowfafad2,lightgrayd3d3d3,lightgreen90ee90,lightpinkffb6c1,lightsalmonffa07a,lightseagreen20b2aa,lightskyblue87cefa,lightslategray778899,lightsteelblueb0c4de,lightyellowffffe0,lime00ff00,limegreen32cd32,linenfaf0e6,maroon800000,mediumaquamarine66cdaa,mediumblue0000cd,mediumorchidba55d3,mediumpurple9370db,mediumseagreen3cb371,mediumslateblue7b68ee,mediumspringgreen00fa9a,mediumturquoise48d1cc,mediumvioletredc71585,midnightblue191970,mintcreamf5fffa,mistyroseffe4e1,moccasinffe4b5,navajowhiteffdead,navy000080,oldlacefdf5e6,olive808000,olivedrab6b8e23,orangeffa500,orangeredff4500,orchidda70d6,palegoldenrodeee8aa,palegreen98fb98,paleturquoiseafeeee,palevioletreddb7093,papayawhipffefd5,peachpuffffdab9,perucd853f,pinkffc0cb,plumdda0dd,powderblueb0e0e6,purple800080,redff0000,rosybrownbc8f8f,royalblue4169e1,saddlebrown8b4513,salmonfa8072,sandybrownf4a460,seagreen2e8b57,seashellfff5ee,siennaa0522d,silverc0c0c0,skyblue87ceeb,slateblue6a5acd,slategray708090,snowfffafa,springgreen00ff7f,steelblue4682b4,tand2b48c,teal008080,thistled8bfd8,tomatoff6347,turquoise40e0d0,violetee82ee,wheatf5deb3,whiteffffff,whitesmokef5f5f5,yellowffff00,yellowgreen9acd32";

let table: readonly (readonly [name: string, rgb: readonly [number, number, number]])[] | null =
  null;

function named() {
  table ??= NAMED.split(",").map((entry) => {
    const hex = entry.slice(-6);
    return [entry.slice(0, -6), rgbOf(hex)!] as const;
  });
  return table;
}

/** `#rgb` or `#rrggbb`, as its channels; `null` for anything else. */
function rgbOf(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const digits = match[1]!.length === 3 ? [...match[1]!].map((d) => d + d).join("") : match[1]!;
  return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
}

/** `#rrggbb` in lower case for a hex colour, else `null`. */
export function hexColor(value: string): string | null {
  const rgb = rgbOf(value);
  return rgb ? `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}` : null;
}

/** CSS3's other spellings of colours the table names once. */
const TWINS = new Set([
  "cyan",
  "magenta",
  "grey",
  "darkgrey",
  "darkslategrey",
  "dimgrey",
  "lightgrey",
  "lightslategrey",
  "slategrey",
]);

/** Whether `value` is one of CSS3's colour names, in any case. */
export function isColorName(value: string): boolean {
  const name = value.trim().toLowerCase();
  return TWINS.has(name) || named().some(([n]) => n === name);
}

/** The CSS3 colour name nearest a hex colour, by distance in RGB; `null` for no hex. */
export function nearestColorName(hex: string): string | null {
  const rgb = rgbOf(hex);
  if (!rgb) return null;
  let best = "";
  let distance = Infinity;
  for (const [name, [r, g, b]] of named()) {
    const d = (r - rgb[0]) ** 2 + (g - rgb[1]) ** 2 + (b - rgb[2]) ** 2;
    if (d < distance) {
      best = name;
      distance = d;
    }
  }
  return best;
}
