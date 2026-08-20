// Keyless assembled-browser coverage for the /feedback command over the
// shipped Web bundles and the real host wire. The command plane settles
// without a model turn: the host appends the log-only command/run +
// feedback/record + command/done lifecycle, and the transcript renders the
// acknowledgement — the recorded session id plus the session-sharing
// disclosure — as a persistent command row. This scenario also pins the fresh
// profile's egress default: one conversation-model request, a local fallback
// title, no auxiliary title request, and feedback retained under DISABLED
// telemetry.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, recordFixture, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/feedback-command', import.meta.url))
const FIXTURE = join(SNAPSHOT_DIR, 'session.jsonl')
const ACK_EXPECTED = join(SNAPSHOT_DIR, 'ack.expected.md')
const MODE = webSnapshotMode()
const PROMPT = 'Reply with the single word LIGHTHOUSE and stop.'

describe('web e2e: /feedback command acknowledgement', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold(MODE === 'record' ? {} : { replayFixture: FIXTURE })
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    // Fresh world: connecting a workspace births the blank session whose
    // live composer accepts the slash line.
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('drives the recorded prompt to a settled turn (all modes)', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-feedback-drive'))
    if (MODE !== 'record') {
      // Drift guard: the committed fixture must carry exactly the drive prompt.
      expect(fixtureUserPrompts(await readFile(FIXTURE, 'utf8'))).toEqual([PROMPT])
    }
    const input = page.locator('textarea').first()
    await input.waitFor({ timeout: 10_000 })
    // Arm the turn-boundary waiter BEFORE sending, so a burst replay cannot
    // miss the turn/end that settles the recorded turn.
    const settled = scaffold.whenTurnSettled()
    await input.fill(PROMPT)
    await input.press('Enter')
    const sessionId = await settled
    const session = scaffold.ctx.agents.get(sessionId)?.session
    if (session === undefined) throw new Error('settled feedback scenario has no live session')
    expect(session.events.filter(event => event.type === 'request/header')).toHaveLength(1)
    expect(session.events.filter(event => event.type === 'session/title-llm-request')).toHaveLength(0)
    expect(session.events.find(event => event.type === 'session/title')?.data.source).toEqual({ kind: 'fallback' })
    if (MODE === 'record') {
      await recordFixture(scaffold, sessionId, FIXTURE)
    }
  }, 60_000)

  it.skipIf(MODE === 'record')('records feedback and renders the acknowledgement with session id and sharing status', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-feedback-command'))
    // The drive test settled the recorded turn: the transcript is active (a
    // command row does not render while a fresh session is still blank) and
    // the replayed reply is on screen.
    await page.getByText('LIGHTHOUSE', { exact: true }).waitFor({ timeout: 15_000 })
    const input = page.locator('textarea').first()
    await input.fill('/feedback the diff view is unreadable')
    await input.press('Enter')
    // The command plane settles without a model turn: the ack row names the
    // recorded session and the mounted disabled backend's disclosure.
    await page.getByText(/Feedback recorded for session/).waitFor({ timeout: 10_000 })
    expect(await page.getByText(/Session sharing is disabled/).count()).toBe(1)
    const snapshot = await captureStableAria(page, '[class*="centerCol"]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(ACK_EXPECTED, snapshot, MODE)

    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it.skipIf(MODE === 'record')('keeps the fixture inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['session.jsonl', 'ack.expected.md'])
  })
})
