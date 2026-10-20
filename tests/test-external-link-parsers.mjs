function isExternalResourceUrl(href, currentHref = "https://kennesaw.view.usg.edu/d2l/home/9900003") {
  if (!href) return false;
  let url;
  try {
    url = new URL(href, currentHref);
  } catch {
    return false;
  }
  if (!/^https?:$/i.test(url.protocol)) return false;
  if (url.origin !== new URL(currentHref).origin) return true;
  return /\/common\/dialogs\/quickLink\/quickLink\.d2l/i.test(url.pathname);
}

function linkRow({ href, title, source = "courseLink" }) {
  const url = new URL(href, "https://kennesaw.view.usg.edu/d2l/home/9900003").href;
  return {
    source: source === "courseLink" && isExternalResourceUrl(url) ? "externalLink" : source,
    title,
    url,
    columns: {
      linkKind: source === "courseLink" && isExternalResourceUrl(url) ? "external" : "internal"
    }
  };
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const offsite = linkRow({
  href: "https://publisher.example.edu/courseware/week-1",
  title: "Publisher Courseware"
});

assertEqual(offsite.source, "externalLink", "off-site course link emits externalLink");
assertEqual(offsite.columns.linkKind, "external", "off-site course link records external kind");

const quickLink = linkRow({
  href: "https://kennesaw.view.usg.edu/d2l/common/dialogs/quickLink/quickLink.d2l?ou=9900003&type=lti",
  title: "Integrated textbook"
});

assertEqual(quickLink.source, "externalLink", "D2L quickLink course link emits externalLink");
assertEqual(quickLink.columns.linkKind, "external", "D2L quickLink course link records external kind");

const internal = linkRow({
  href: "https://kennesaw.view.usg.edu/d2l/le/content/9900003/Home",
  title: "Content"
});

assertEqual(internal.source, "courseLink", "ordinary D2L course link stays courseLink");
assertEqual(internal.columns.linkKind, "internal", "ordinary D2L course link records internal kind");

console.log("External link parser tests passed.");
