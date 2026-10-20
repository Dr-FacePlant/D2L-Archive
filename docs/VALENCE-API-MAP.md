# D2L Valence API Map

This project uses a hybrid extractor: the Valence API is the first choice for structured, stable data, and read-only D2L page probes are the proof layer for rendered-only details, course-specific permissions, attachments, empty states, and anything the student can see but the API does not expose to this session.

Reference root: https://docs.valence.desire2learn.com/reference.html

## Remaining Student Areas

| Area | Valence API route family | Read-only UI proof | Export rows/signals | Why both are needed |
| --- | --- | --- | --- | --- |
| 1. Rubric details and feedback | `/d2l/api/le/(version)/(orgUnitId)/rubrics/`, `/rubrics/(rubricId)`, `/assessment` | Assignment feedback pages, gradebook pages, discussion topic/post pages that render rubrics | `rubric`, `rubricFeedback`, `rubricCriterionFeedback`, `gradeFeedback`, `discussionFeedback` | Rubric definitions and assessments can be separate. The API may expose rubric objects while the rendered student page is the only proof of released levels, criteria, scores, and instructor comments visible to the student. |
| 2. Released quiz/exam feedback and question/attempt results | `/d2l/api/le/(version)/(orgUnitId)/quizzes/`, `/quizzes/(quizId)/attempts/` | `quiz_summary.d2l`, `quiz_submissions.d2l`, `quiz_submissions_attempt.d2l` | `quiz`, `quizAttempt`, `quizSubmission`, `quizAttemptRow`, `quizSummaryRow`, `quizQuestionResult`, `apiProbe` | Quiz setup and attempt metadata are API-friendly, but released question text, question feedback, review views, and instructor release restrictions often only appear on the student result pages. Never crawl quiz start/active-attempt pages. |
| 3. Grade item feedback/comments | `/d2l/api/le/(version)/(orgUnitId)/grades/`, `/grades/values/myGradeValues/` | `grades/my_grades/main.d2l` and any read-only grade detail/rubric links | `gradeItem`, `gradeFeedback`, `rubricFeedback`, `rubricCriterionFeedback` | Grade values join cleanly by `GradeObjectIdentifier`, but comments, rubric text, and visual feedback can be hidden, absent, or rendered differently per course. |
| 4. Assignment submission history and feedback completeness | `/d2l/api/le/(version)/(orgUnitId)/dropbox/folders/`, `/dropbox/folders/(folderId)/submissions/mysubmissions/`, submitted-file endpoints | `folders_history.d2l`, `folder_user_view_feedback.d2l` | `assignment`, `assignmentSubmission`, `submittedFile`, `assignmentFeedback`, `rubricFeedback`, `apiProbe` | Dropbox folders expose instructions, dates, attachments, submissions, files, and feedback blocks. UI probes prove what the student can see and avoid treating denied/empty API responses as missing parser coverage. |
| 5. Announcement detail pages and attachments | `/d2l/api/le/(version)/(orgUnitId)/news/`, `/news/(newsItemId)/attachments/(fileId)` | `/d2l/le/news/(orgUnitId)/(newsItemId)/view` | `announcement`, `announcementAttachment`, `announcementLink`, `apiProbe` | The API can provide news rows and attachment ids, but rendered detail pages prove full body text, embedded links, and attachment links as seen by the student. |
| 6. Disabled/empty course tools | Tool-specific APIs when available, plus page access status | `classlist`, `checklist`, `group`, `selfassess`, `survey`, `attendance`, `userprogress` pages | `courseToolPage`, `checklistItem`, `survey`, `selfAssessment`, `attendanceRecord`, `group`, `classlistEntry`, `progressRecord`, `apiProbe` | Empty, disabled, permission-blocked, and not-enabled states are user-facing facts. The UI page often gives the best evidence that a tool exists but has no visible rows or is unavailable. |
| 7. Content text/HTML snapshots for AI querying | `/d2l/api/le/(version)/(orgUnitId)/content/toc`, course file APIs | Content topic/viewer pages and downloaded file links | `contentModule`, `contentTopic`, `contentAttachment`, `externalLink`, `localPageTextPath` | TOC data gives hierarchy and IDs; rendered pages preserve the readable text, HTML body, quicklinks, and file links an AI query needs. |
| 8. Change detection/daily update mode | Same API/page rows as the current export, compared with prior manifest summaries | A later targeted or daily run | `change-report.md`, `change-report.json`, `student-action-brief.md`, `newlyFeedback`, `dueChanged`, `availabilityChanged` | Change detection is only meaningful across two exports with stable IDs and preserved status/date/feedback/download fields. |

## Read-Only Rules

- Use only `GET` Valence routes and read-only D2L page URLs.
- Do not visit assignment submit pages, quiz start pages, active attempt pages, discussion create/reply pages, mail, settings, delete, or subscription-management URLs.
- Treat `403`, hidden, unavailable, and available-empty API/page states as useful `apiProbe` or `courseToolPage` evidence, not as parser failure by default.
- Prefer targeted validation plans over full semester reruns when proving one area.
