// An image Vite inlines into the main process's bundle as a data URL (the tray's icon).
declare module "*.png?inline" {
  const dataUrl: string;
  export default dataUrl;
}
