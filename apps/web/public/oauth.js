// An OAuth sign-in's answer, back from the service (docs/plans/providers.md#D254):
// its address to the app's tab that waits for it (src/oauth.ts), then this
// window closes. The channel is the app's origin's alone.
// oxlint-disable-next-line unicorn/require-post-message-target-origin -- a BroadcastChannel takes none: it is the origin's own
new BroadcastChannel("astrotime-oauth").postMessage(location.href);
window.close();
