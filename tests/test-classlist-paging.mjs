// The class list comes from D2L one page at a time. Every course used to stop
// at 25 people because only the first page was read; ART's and HIST's
// instructors were on a later page. This checks that sync follows D2L's Next
// link to the end, stays on D2L's own site, and can't loop forever.
import { loadContentHooks } from "./test-production-loader.mjs";

const OU = "9900004";
const ORIGIN = "https://kennesaw.view.usg.edu";
const first = `/d2l/api/le/1.82/${OU}/classlist/paged/?pageSize=200`;
const second = `/d2l/api/le/1.82/${OU}/classlist/paged/?bookmark=25`;
const students = (from, count) => Array.from({ length: count }, (_, i) => ({ Identifier: String(from + i), DisplayName: `Student ${from + i}`, ClasslistRoleDisplayName: "Student", RoleId: 110 }));

function run(routes) {
  const fetched = [];
  const fetch = async (pathname) => {
    fetched.push(pathname);
    const body = routes[pathname];
    if (body === undefined) return { ok: false, status: 404, json: async () => null, headers: { get: () => "" } };
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)), headers: { get: () => "application/json" } };
  };
  // The class list is read as part of a course's API collection; every other
  // D2L route answers 404 here.
  const result = loadContentHooks({ fetch }).collectCourseApi(OU).then((payload) => ({
    items: payload.items.filter((item) => item.source === "classlistEntry")
  }));
  return { fetched: { get pages() { return fetched.filter((path) => path.includes("/classlist/")); } }, result };
}

const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

// Two pages: 25 students, then the instructor.
{
  const { fetched, result } = run({
    [first]: { Next: `${ORIGIN}${second}`, Objects: students(1, 25) },
    [second]: { Next: null, Objects: [{ Identifier: "900", DisplayName: "Instructor, Art", ClasslistRoleDisplayName: "Instructor", RoleId: 109 }] }
  });
  const { items } = await result;
  check(items.length === 26, `two pages should give 26 people, got ${items.length}`);
  check(items.some((item) => item.columns.roleName === "Instructor" && item.title === "Instructor, Art"), "the instructor on page 2 was dropped");
  check(fetched.pages.length === 2 && fetched.pages[1] === second, `should fetch page 2 by its path, fetched ${fetched.pages.join(", ")}`);
}

// A Next link to another site is never followed.
{
  const { fetched, result } = run({ [first]: { Next: "https://evil.example/d2l/api/le/1.82/9900004/classlist/paged/?bookmark=25", Objects: students(1, 25) } });
  const { items } = await result;
  check(items.length === 25 && fetched.pages.length === 1, "an off-site Next link was followed");
}

// A page that points back at itself stops instead of looping.
{
  const { fetched, result } = run({ [first]: { Next: `${ORIGIN}${first}`, Objects: students(1, 3) } });
  const { items } = await result;
  check(items.length === 3 && fetched.pages.length === 1, `a self-pointing Next link looped (${fetched.pages.length} fetches)`);
}

// A failed first page gives no people.
{
  const { result } = run({});
  const { items } = await result;
  check(items.length === 0, `a failed class list should give no people, got ${items.length}`);
}

if (failures.length) {
  console.error(`Class list paging checks failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}
console.log("Class list paging follows D2L's Next link.");
