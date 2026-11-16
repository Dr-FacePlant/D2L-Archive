// Voice mode fills the wait while Ask works with a short spoken line that names what it is doing
// ("Let me check what's due."). Which line, and whether one is wanted at all, is decided here; saying it,
// and keeping the sound once it is made, is the speaker's job.
// createFiller() → { startQuestion(), forLookup(toolName, round), forWait() }: each returns a line to say, or null.
(function initVoiceFillerLines(global) {
  const dash = global.D2LDashboard ||= {};

  // By what Ask is about to look up. Each has two wordings, used in turn, so the same words do not come twice running.
  const LINES = {
    search_archive: ["Searching your course files.", "Looking through your course material."],
    upcoming_due: ["Let me check what's due.", "Checking your due dates."],
    search_past_messages: ["Looking back through our chat.", "Checking what we talked about."],
    chat_log: ["Looking back through our chat.", "Checking what we talked about."],
    item_details: ["Opening that item.", "Reading the details."],
    other: ["One moment.", "Still working on it."]
  };
  // More than this in one answer is chatter, not company.
  const MOST_PER_QUESTION = 2;

  function createFiller({ most = MOST_PER_QUESTION } = {}) {
    const used = new Map();
    let said = 0, last = "", lastRound = -1;

    function pick(group) {
      if (said >= most) return null;
      // The model names the tool, so a name that is not one of ours gets the plain line.
      const lines = Object.hasOwn(LINES, group) ? LINES[group] : LINES.other;
      const next = () => { const turn = used.get(group) || 0; used.set(group, turn + 1); return lines[turn % lines.length]; };
      let line = next();
      if (line === last) line = next();
      said += 1; last = line;
      return line;
    }

    return {
      startQuestion() { said = 0; lastRound = -1; },
      // A round can start several lookups at once; the first gets the line.
      forLookup(toolName, round = -2) {
        if (round === lastRound) return null;
        const line = pick(toolName);
        if (line) lastRound = round;
        return line;
      },
      forWait: () => pick("other")
    };
  }

  dash.createFiller = createFiller;
  dash.FILLER_LINES = LINES;
})(globalThis);
