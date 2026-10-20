(() => {
  const content = globalThis.D2LExtractorContent ||= {};

  function looksLikeFileUrl(href) {
    if (/\/d2l\/lms\/dropbox\/user\/(?:folder_submit_files|folders_history|folder_user_view_feedback)\.d2l/i.test(href)) return false;
    return /\/d2l\/api\/.*\/files?\//i.test(href)
      || /\/d2l\/api\/.*\/attachments?\//i.test(href)
      || /\/d2l\/common\/dialog\/file/i.test(href)
      || /\/d2l\/common\/viewFile\.d2lfile\//i.test(href)
      || /[?&](?:fileId|fid|cfql|download)=/i.test(href)
      || /\/d2l\/lms\/dropbox\/.*(?:file|download|get)/i.test(href)
      || /\/d2l\/lp\/(?:file|files|attachments)\//i.test(href)
      || /\/content\/enforced\//i.test(href)
      || /\.(?:pdf|docx?|pptx?|xlsx?|csv|txt|rtf|zip|png|jpe?g|gif|heic|mp4|mov|m4a|mp3)(?:[?#]|$)/i.test(href);
  }

  Object.assign(content, { looksLikeFileUrl });
})();
