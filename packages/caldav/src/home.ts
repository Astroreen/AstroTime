// What the first load needs of a CalDAV account without the provider, which
// loads with the first sync or sign-in (`@astrotime/caldav/provider`,
// docs/plans/providers.md#D255): its credentials, where discovery found it,
// and whether it is Nextcloud's.

export interface Credentials {
  readonly username: string;
  /** A password, or a Nextcloud app password (docs/plans/foundation.md#D19). */
  readonly password: string;
}

/** Where discovery found an account's calendars. */
export interface Discovery {
  readonly principalUrl: string;
  readonly homeUrl: string;
}

/** The address answers, but no CalDAV calendar home was found there (RFC 6764). */
export class NoCalendarHomeError extends Error {
  override name = "NoCalendarHomeError";
}

/** Where Nextcloud keeps a calendar home: its server's root, and the user's name in the path. */
export const NEXTCLOUD_HOME = /^(.*)\/remote\.php\/dav\/calendars\/([^/]+)\/?$/;

/** Whether a calendar home's server keeps the user's files beside it (Nextcloud's, foundation D231). */
export const keepsFiles = (homeUrl: string) => NEXTCLOUD_HOME.test(homeUrl);
