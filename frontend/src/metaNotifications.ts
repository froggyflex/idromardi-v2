export const META_UNREAD_REFRESH_EVENT = "idromardi:meta-unread-refresh";

export function requestMetaUnreadRefresh() {
  window.dispatchEvent(new Event(META_UNREAD_REFRESH_EVENT));
}
