import { Octokit } from "@octokit/rest";
import fetch from 'node-fetch';
import fs from 'fs';
import * as process from 'process';

const GH_TOKEN = process.env.GH_TOKEN;
const dryRun = process.env.DRY_RUN === 'true';

const repository = process.env.REPOSITORY;
const userName = process.env.ASSIGN_USER;
const diaryLabel = process.env.ISSUE_LABEL;
const issueTemplate = process.env.ISSUE_TEMPLATE;
const typetalkTopicId = process.env.TYPETALK_TOPIC_ID;
const typetalkToken = process.env.TYPETALK_TOKEN;
const targetDayOffsetString = process.env.TARGET_DAY_OFFSET;

if (!repository) {
  console.error('REPOSITORY environment variable is not set.');
  process.exit(1);
}
if (!typetalkTopicId) {
  console.error('TYPETALK_TOPIC_ID environment variable is not set.');
  process.exit(1);
}
if (!typetalkToken) {
  console.error('TYPETALK_TOKEN environment variable is not set.');
  process.exit(1);
}

const issueTemplateContent = issueTemplate && fs.existsSync(issueTemplate) && fs.readFileSync(issueTemplate, { encoding: 'utf-8' }) || '';

const targetDayOffset = parseInt(targetDayOffsetString || '') || 0;

const [repoOwner, repoName] = repository.split('/')

const octokit = new Octokit({
  auth: GH_TOKEN,
  userAgent: 'ny-a/sechack365-habituation',
});

const entrypoint = (async () => {
  const now = new Date();

  const countdownMessage = getCountdownMessage(now);

  if (countdownMessage === undefined) {
    // SecHack365 2022 has been ended. Do nothing.
    return;
  }

  now.setHours(now.getHours() + 9); // convert ISOString (UTC) to JST
  const issueList = await octokit.paginate(octokit.issues.listForRepo, {
    owner: repoOwner,
    repo: repoName,
    labels: diaryLabel,
  })

  issueList.forEach(async (issue) => {
    console.log(issue.title);
    const issueComments = (await octokit.paginate(octokit.issues.listComments, {
      owner: repoOwner,
      repo: repoName,
      issue_number: issue.number,
    }));

    const comments = issueComments
      .map((comment) => {
        const user = comment.user && comment.user.login !== repoOwner ? ` (@${comment.user?.login})` : '';
        return `${dateStringToLocalTime(comment.created_at)}${user} ${comment.body}`;
      })
      .join('\n');

    const issueBody = convertIssueBodyToEmoji(issue.body);

    const message = `${issue.title}振り返り\n${issueBody}\nコメント:\n${comments}\n`;

    await postToTypeTalk(message);

    if (!dryRun) {
      const issueCloseResult = await octokit.issues.update({
        owner: repoOwner,
        repo: repoName,
        issue_number: issue.number,
        state: 'closed',
      })
      if (issueCloseResult.status !== 200) {
        console.log('issueCloseResult error', issueCloseResult.status)
        return;
      }
    }
  });

  const targetDay = new Date(now.getTime());
  targetDay.setDate(targetDay.getDate() + targetDayOffset);

  const issueTitle = targetDay.toISOString().slice(0, 10);
  const issueBody = `${countdownMessage}\n${issueTemplateContent}`;

  if (!dryRun) {
    const labels = diaryLabel ? [diaryLabel] : [];
    const assignees = userName ? [userName] : [];

    const issueOpenResult = await octokit.issues.create({
      owner: repoOwner,
      repo: repoName,
      title: issueTitle,
      body: issueBody,
      labels,
      assignees,
    })
    if (issueOpenResult.status !== 201) {
      console.log('issueOpenResult error', issueOpenResult.status)
      return;
    }
  }

  await postToTypeTalk(`${issueTitle}の目標：\n${convertIssueBodyToEmoji(issueBody)}`)
});

const convertIssueBodyToEmoji = (body: string | null | undefined) =>
  (body || '')
    .replace(/^- \[ \]/gm, '- :large_green_square:')
    .replace(/^- \[x\]/gm, '- :white_check_mark:');

const postToTypeTalk = (message: string, topicId: string = typetalkTopicId, token: string = typetalkToken) =>
  fetch(
    `https://typetalk.com/api/v1/topics/${topicId}`,
    {
      headers: {
        'X-TYPETALK-TOKEN': token,
        'Content-Type': 'application/json'
      },
      method: 'post',
      body: JSON.stringify({ message })
    }
  );

const dateStringToLocalTime = (s: string) => {
  const date = new Date(s);
  date.setHours(date.getHours() + 9);
  return `${date.getUTCHours().toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}:${date.getUTCSeconds().toString().padStart(2, '0')}`
}

const getCountdownMessage = (now: Date): string | undefined => {
  const nextEventDay = getNextEventDay(now);

  if (nextEventDay === undefined) {
    return undefined;
  }
  const { name, date } = nextEventDay;
  const remainingDays = Math.ceil((date.getTime() - now.getTime()) / 1000 / 60 / 60 / 24);
  return `${name}まであと${remainingDays}日`;
}

const getNextEventDay = (now: Date): ({ name: string, date: Date } | undefined) => {
  const events = [
    { name: '第1回イベント', date: new Date('2022-06-11T00:00:00+09:00') },
    { name: '第2回イベント', date: new Date('2022-07-09T00:00:00+09:00') },
    { name: '第3回イベント', date: new Date('2022-08-24T00:00:00+09:00') },
    { name: '第4回イベント', date: new Date('2022-10-01T00:00:00+09:00') },
    { name: '第5回イベント', date: new Date('2022-11-11T00:00:00+09:00') },
    { name: '第6回イベント', date: new Date('2023-01-27T00:00:00+09:00') },
    { name: '成果発表会', date: new Date('2023-03-04T00:00:00+09:00') },
    { name: '2022年度終了', date: new Date('2023-04-01T00:00:00+09:00') },
  ]

  return events.find(({ date }) => now < date);
}

(() => entrypoint())()
