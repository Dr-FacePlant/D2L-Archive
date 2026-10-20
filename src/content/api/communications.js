(() => {
  const content = globalThis.D2LExtractorContent ||= {};
  const { normalizeText } = globalThis.D2LExtractorShared;
  const { absoluteUrl, apiGet, apiList, richText, firstRichText, collectRubricItems, D2L_API_MODERN_VERSION } = content;

function newsAttachmentUrl(orgUnitId, newsItemId, file) {
  const fileId = file.FileId || file.Id || file.AttachmentId;
  if (!fileId) return "";
  return `${window.location.origin}/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/news/${newsItemId}/attachments/${fileId}`;
}

async function collectNewsItems(orgUnitId) {
  const result = await apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/news/`);
  const items = [];
  if (!result.ok) return { status: result.status, items };

  for (const news of apiList(result.data)) {
    const newsId = news.Id || news.NewsItemId || news.ItemId;
    const attachments = apiList(news.Attachments || news.Files);
    items.push({
      source: "announcement",
      title: normalizeText(news.Title || news.Name || `Announcement ${newsId || ""}`),
      description: richText(news.Body || news.Description || news.Message || news.Content),
      url: newsId ? `${window.location.origin}/d2l/le/news/${orgUnitId}/${newsId}/view` : `${window.location.origin}/d2l/home/${orgUnitId}`,
      status: news.IsPublished === false ? "draftOrHidden" : "publishedOrVisible",
      availabilityText: [news.StartDate, news.EndDate].filter(Boolean).join(" - "),
      columns: {
        startDate: news.StartDate || "",
        endDate: news.EndDate || "",
        // D2L's announcement list dates each item by StartDate ("Start Date").
        publishedDate: news.PublishedDate || news.PublishStartDate || news.StartDate || "",
        createdDate: news.CreatedDate || "",
        lastModified: news.LastModified || news.LastModifiedDate || "",
        isPublished: news.IsPublished ?? "",
        isPinned: news.IsPinned ?? "",
        attachmentCount: attachments.length,
        attachments: attachments.map((file) => ({ name: normalizeText(file.FileName || file.Name || ""), size: file.Size ?? "" }))
      },
      ids: { courseOrgUnitId: orgUnitId, newsItemId: String(newsId || "") }
    });

    for (const file of attachments) {
      const fileName = normalizeText(file.FileName || file.Name || file.DisplayName || `announcement-attachment-${file.FileId || file.Id || ""}`);
      const downloadUrl = newsId ? newsAttachmentUrl(orgUnitId, newsId, file) : absoluteUrl(file.DownloadUrl || file.Url || "");
      items.push({
        source: "announcementAttachment",
        title: fileName,
        description: normalizeText(`Announcement attachment ${fileName}`),
        url: downloadUrl,
        downloadUrl,
        suggestedFileName: fileName,
        ids: { courseOrgUnitId: orgUnitId, newsItemId: String(newsId || ""), fileId: String(file.FileId || file.Id || "") }
      });
    }
  }
  return { status: result.status, items };
}

async function collectDiscussionItems(orgUnitId, myUserId = "") {
  const forumsResult = await apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/discussions/forums/`);
  const items = [];
  const topicStatuses = {};
  const postStatuses = {};
  if (!forumsResult.ok) return { status: forumsResult.status, topicStatuses, postStatuses, items };

  for (const forum of apiList(forumsResult.data)) {
    const forumId = forum.ForumId || forum.Id;
    if (!forumId) continue;
    items.push({
      source: "discussionForum",
      title: normalizeText(forum.Name || forum.Title || `Forum ${forumId || ""}`),
      description: richText(forum.Description),
      url: `${window.location.origin}/d2l/le/${orgUnitId}/discussions/List`,
      status: forum.IsHidden ? "hidden" : forum.IsLocked ? "locked" : "visible",
      availabilityText: [forum.StartDate, forum.EndDate].filter(Boolean).join(" - "),
      columns: {
        postStartDate: forum.PostStartDate || "",
        postEndDate: forum.PostEndDate || "",
        requiresApproval: forum.RequiresApproval ?? "",
        allowAnonymous: forum.AllowAnonymous ?? ""
      },
      ids: { courseOrgUnitId: orgUnitId, discussionForumId: String(forumId || "") }
    });

    const topicsResult = await apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/discussions/forums/${forumId}/topics/`);
    topicStatuses[String(forumId || "")] = topicsResult.status;
    if (!topicsResult.ok) continue;

    for (const topic of apiList(topicsResult.data)) {
      const topicId = topic.TopicId || topic.Id;
      if (!topicId) continue;
      items.push({
        source: "discussionTopic",
        title: normalizeText(topic.Name || topic.Title || `Topic ${topicId || ""}`),
        description: richText(topic.Description),
        url: `${window.location.origin}/d2l/le/${orgUnitId}/discussions/topics/${topicId}/View`,
        status: topic.IsHidden ? "hidden" : topic.IsLocked ? "locked" : "visible",
        // Valence names the "Must post first." rule MustPostToParticipate.
        gate: topic.MustPostToParticipate || topic.MustPostFirst ? "mustPostFirst" : "",
        availabilityText: [topic.StartDate || topic.UnlockStartDate, topic.EndDate || topic.UnlockEndDate].filter(Boolean).join(" - "),
        columns: {
          forumTitle: normalizeText(forum.Name || ""),
          startDate: topic.StartDate || topic.UnlockStartDate || "",
          endDate: topic.EndDate || topic.UnlockEndDate || "",
          unlockStartDate: topic.UnlockStartDate || "",
          unlockEndDate: topic.UnlockEndDate || "",
          isLocked: topic.IsLocked ?? "",
          postStartDate: topic.PostStartDate || "",
          postEndDate: topic.PostEndDate || "",
          requiresApproval: topic.RequiresApproval ?? "",
          topicType: topic.Type ?? "",
          groupTypeId: topic.GroupTypeId ?? "",
          scoreOutOf: topic.ScoreOutOf ?? "",
          threadCount: topic.ThreadCount ?? "",
          postCount: topic.PostCount ?? ""
        },
        ids: { courseOrgUnitId: orgUnitId, discussionForumId: String(forumId || ""), discussionTopicId: String(topicId || "") }
      });

      const rubricResult = await collectRubricItems(orgUnitId, "Discussion", topicId, { discussionForumId: String(forumId || ""), discussionTopicId: String(topicId) }, myUserId, topic.Name || "");
      items.push(...rubricResult.items);

      const postsResult = await apiGet(`/d2l/api/le/${D2L_API_MODERN_VERSION}/${orgUnitId}/discussions/forums/${forumId}/topics/${topicId}/posts/?pageSize=1000&pageNumber=1&sort=threaded`);
      postStatuses[`${forumId}:${topicId}`] = postsResult.status;
      if (!postsResult.ok) continue;
      for (const post of apiList(postsResult.data).slice(0, 500)) {
        const postId = post.PostId || post.Id;
        const author = normalizeText(post.PostingUserDisplayName || post.Author?.DisplayName || post.CreatedBy?.DisplayName || "");
        const attachments = apiList(post.Attachments || post.Files);
        items.push({
          source: "discussionPost",
          title: normalizeText(post.Subject || `Post ${postId || ""}`),
          description: richText(post.Message || post.Body || post.Content),
          url: `${window.location.origin}/d2l/le/${orgUnitId}/discussions/forums/${forumId}/topics/${topicId}/posts/${postId}`,
          status: post.IsDeleted ? "deleted" : post.IsApproved === false ? "unapproved" : "visible",
          columns: {
            author,
            createdDate: post.DatePosted || post.CreatedDate || "",
            lastModified: post.LastModifiedDate || post.DateModified || "",
            parentPostId: post.ParentPostId ?? "",
            threadId: post.ThreadId ?? "",
            postingUserId: post.PostingUserId ?? "",
            isMine: Boolean(myUserId) && String(post.PostingUserId ?? "") === String(myUserId),
            attachmentCount: attachments.length
          },
          ids: { courseOrgUnitId: orgUnitId, discussionForumId: String(forumId || ""), discussionTopicId: String(topicId || ""), postId: String(postId || "") }
        });

        for (const file of attachments) {
          const fileId = file.FileId || file.Id || file.AttachmentId;
          const fileName = normalizeText(file.FileName || file.Name || file.DisplayName || `discussion-attachment-${fileId || ""}`);
          const downloadUrl = absoluteUrl(file.DownloadUrl || file.Url || file.Href || "");
          items.push({
            source: "discussionAttachment",
            title: fileName,
            description: normalizeText(`Discussion attachment ${fileName} from ${post.Subject || `post ${postId || ""}`}`),
            url: downloadUrl || `${window.location.origin}/d2l/le/${orgUnitId}/discussions/forums/${forumId}/topics/${topicId}/posts/${postId}`,
            downloadUrl,
            suggestedFileName: fileName,
            columns: {
              author,
              postSubject: normalizeText(post.Subject || ""),
              createdDate: post.DatePosted || post.CreatedDate || ""
            },
            ids: { courseOrgUnitId: orgUnitId, discussionForumId: String(forumId || ""), discussionTopicId: String(topicId || ""), postId: String(postId || ""), fileId: String(fileId || "") }
          });
        }
      }
    }
  }
  return { status: forumsResult.status, topicStatuses, postStatuses, items };
}


  Object.assign(content, { newsAttachmentUrl, collectNewsItems, collectDiscussionItems });
})();
