// A picture imported as a file of its own, never inlined into the script
// (design D219): the build gives its URL.
declare module "*.svg?no-inline" {
  const url: string;
  export default url;
}

// A bundled font's file (design D294), the same way.
declare module "*.woff2?no-inline" {
  const url: string;
  export default url;
}
