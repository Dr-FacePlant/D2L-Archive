// Voice mode speaks an answer while Ask is still writing it. This cuts the text written so far into
// sentences, one at a time, as soon as each is whole, and turns each into plain words (no Markdown).
// push(text) takes everything written so far and returns the sentences that became whole since the last
// call; finish() returns what is left once the answer is done. Heard aloud, a table is a pile of words and
// a long list a long wait, so table rows are not spoken, nor are list items after the third; finish() then
// adds one line saying the rest is on the screen.
(function initVoiceSpeakableSentences(global) {
  const dash = global.D2LDashboard ||= {};

  // A table row (or the rule under its header) and a list item, by how the line starts.
  const TABLE_LINE = /^[ \t]*(?:\||:?-{3,}:?[ \t]*\|)/;
  const LIST_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/;
  const MOST_LIST_ITEMS = 3;
  const ON_SCREEN = "The rest is on your screen.";

  // An end mark, with any closing quote, bracket or Markdown mark after it, and a space or line end next.
  const END = /[.!?]+["'”’)\]*_`]*(?=\s)/g;
  // Words that end in a dot without ending the sentence ("Dr. Lee", "Nov. 7").
  const ABBREVIATION = /(?:^|[\s("'*_])(?:e\.g|i\.e|vs|dr|mr|mrs|ms|prof|fig|st|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\.$/i;

  // Where the first whole sentence in text[from..] ends, and where the next one starts. A line end
  // always ends one. null while the sentence is still being written.
  function cutPoint(text, from) {
    const rest = text.slice(from);
    const newline = rest.indexOf("\n");
    const line = newline < 0 ? rest : rest.slice(0, newline);
    END.lastIndex = 0;
    for (let found = END.exec(line); found; found = END.exec(line)) {
      const end = found.index + found[0].length;
      let next = end;
      while (next < line.length && /[ \t]/.test(line[next])) next += 1;
      if (next >= line.length) break;
      if (found[0] === ".") {
        // A lower-case letter next, a list number ("1."), or a short form like "Dr." does not end a sentence.
        if (/[a-z]/.test(line[next]) || /^\s*\d+$/.test(line.slice(0, found.index)) || ABBREVIATION.test(line.slice(0, end))) continue;
      }
      return { end, next };
    }
    return newline < 0 ? null : { end: newline, next: newline + 1 };
  }

  function createSentenceStream({ speakable = (text) => dash.askSpeechText(text) } = {}) {
    let seen = "", from = 0, items = 0, line = -1, leave = false, left = false;

    // Whether the line that holds seen[at..] is left out. A line is judged once, at its first sentence.
    function leftOut(at) {
      const start = at === 0 ? 0 : seen.lastIndexOf("\n", at - 1) + 1;
      if (start !== line) {
        const text = seen.slice(start).split("\n", 1)[0];
        const item = LIST_ITEM.test(text);
        if (item) items += 1;
        line = start;
        leave = TABLE_LINE.test(text) || (item && items > MOST_LIST_ITEMS);
      }
      if (leave) left = true;
      return leave;
    }

    function say(at, segment) {
      if (leftOut(at)) return [];
      const spoken = speakable(segment);
      return spoken ? [spoken] : [];
    }

    function push(text) {
      const written = String(text || "");
      // Ask starts the answer over after a lookup. What was said before can't be taken back.
      if (!written.startsWith(seen)) { from = 0; items = 0; line = -1; leave = false; left = false; }
      seen = written;
      const sentences = [];
      for (let cut = cutPoint(seen, from); cut; cut = cutPoint(seen, from)) {
        sentences.push(...say(from, seen.slice(from, from + cut.end)));
        from += cut.next;
      }
      return sentences;
    }

    function finish() {
      const rest = seen.slice(from);
      const sentences = rest ? say(from, rest) : [];
      from = seen.length;
      if (left) { left = false; sentences.push(ON_SCREEN); }
      return sentences;
    }

    return { push, finish };
  }

  dash.createSentenceStream = createSentenceStream;
})(globalThis);
