'use strict';
// ─── Game Wizard ─────────────────────────────────────────────────────────────
// A kid logs in and chats with an AI helper (the requirements-analyst persona)
// that co-designs a game with them, then saves a complete, testable game request
// for a grown-up to review and the build pipeline to pick up.
//
// The AI runs through the Anthropic API, so this needs ANTHROPIC_API_KEY in the
// environment (or a gitignored .env). Without it, /api/chat returns a clear 503.
// Model: claude-opus-4-8, streamed; a save_game_request tool persists the design.
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const db      = require('../shared/db');
const { requireAuth } = require('../shared/auth');

const MODEL = process.env.WIZARD_MODEL || 'claude-opus-4-8';

const SAVE_TOOL = {
  name: 'save_game_request',
  description: 'Save the finished game design once you and the child have agreed on all of it. Only call this when you understand the game completely: the skill it teaches and how it is tested, the gameplay, the multiplayer style, and the look. Assemble clear, testable acceptance criteria.',
  input_schema: {
    type: 'object',
    properties: {
      title:          { type: 'string', description: 'A fun name for the game' },
      summary:        { type: 'string', description: 'One or two sentences a kid would recognize' },
      subject:        { type: 'string', description: 'School subject / skill area, e.g. spelling, math, typing, reading' },
      goal:           { type: 'string', enum: ['struggle', 'reinforce'], description: 'struggle = shore up a hard skill; reinforce = stretch a favorite' },
      age_or_grade:   { type: 'string', description: 'Target age or grade' },
      skills_tested:  { type: 'array', items: { type: 'string' }, description: 'The specific skills the game practices/tests' },
      test_criteria:  { type: 'array', items: { type: 'string' }, description: 'Testable acceptance criteria, each checkable (Given/When/Then style)' },
      gameplay:       { type: 'string', description: 'The core action the player does, described plainly' },
      multiplayer:    { type: 'string', description: 'How other players appear/interact (observe-only, cooperative, or limited-interaction) and why it cannot disrupt another child’s learning' },
      graphics_style: { type: 'string', description: 'The art/sound style the child liked (kid words are fine)' },
    },
    required: ['title', 'summary', 'subject', 'gameplay', 'multiplayer', 'test_criteria'],
  },
};

function systemPrompt(username) {
  return `You are the Game Wizard for "Family Games" — a warm, patient helper who designs a new educational web game *with a child*, one small step at a time. The child's name is ${username}.

The child may be very young and knows nothing about computers or programming. NEVER use technical words. Talk like a friendly teacher: short sentences, one or two questions at a time, lots of encouragement and concrete examples at their level.

Your job is to understand a complete, buildable game by the end of the chat. Cover, gently and in kid language:
- What school subjects they want to practice. Ask things like "Do you need to practice any school subjects?", "What is your hardest subject?", "What is your favorite subject?" A game can either help with a HARD subject or make a FAVORITE subject even better — find out which they want.
- The skill the game practices and how we would know they're getting better (this becomes testable criteria — you fill in the school/learning parts they won't know).
- The gameplay — the main thing the player does. Offer a few fun examples to pick from (e.g. "catch the falling word", "drive a train by typing", "feed the alligator the right number").
- The look and sound — offer choices like pictures (🚀 rocket? 🐶 puppy? 🟦 blocky pixel art?) and sounds (a "boing", a "sparkle", cheerful music). Describe little sample screens in words.
- Do quick "pretend play" checks: describe a tiny moment of the game ("A word floats down… you type it before it lands — ping!") and ask "Is that fun? Should it be faster or slower?" Use their answers to refine.

IMPORTANT house rules (these are firm — steer the child so the design fits them, without lecturing):
- EVERY game is multiplayer. Decide together how other players show up: just seeing each other play (safest), teaming up for a shared score, or gentle interaction. A player must NEVER be able to mess up another child's learning — no forcing wrong answers on someone, no blocking them. If an idea breaks this, steer to a friendlier version.
- Any story or picture content must be free-to-use (public domain) — classic tales, simple shapes, emoji-style art. Don't promise specific copyrighted characters (no Elsa, Pokémon, etc.); if they ask, offer a friendly original instead.
- The game joins a family of games that already share one login and a teacher dashboard — keep the idea in that spirit (a single clear main action, playable in a browser).

Fill in the educational gaps the child can't (grade-appropriate learning goals, what mastery looks like, sensible difficulty) — you are the expert there.

Pace yourself: don't ask everything at once. Build understanding across several friendly turns. When — and only when — you understand the whole game (skill + how it's tested + gameplay + multiplayer + look), call the save_game_request tool with clear, testable criteria, then tell the child in a happy way that their game idea is saved and a grown-up will look at it. Keep every message short.`;
}

module.exports = function createWizard({ base = '/wizard' } = {}) {
  const router = express.Router();
  router.use(express.json({ limit: '256kb' }));
  router.use(express.static(path.join(__dirname, 'public')));

  // Key from the server environment, else one a teacher set in the dashboard.
  const getKey = () => process.env.ANTHROPIC_API_KEY || db.getSetting('anthropic_api_key') || '';
  const SPECS_DIR = path.join(__dirname, '..', 'specs');

  function slugify(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'game';
  }

  function saveRequest(player, input) {
    const slug = slugify(input.title);
    const requirements =
`# Game request: ${input.title}

- **Requested by:** ${player.username}
- **Subject:** ${input.subject || '—'}   **Goal:** ${input.goal === 'reinforce' ? 'stretch a favorite subject' : input.goal === 'struggle' ? 'shore up a hard skill' : '—'}
- **Target age/grade:** ${input.age_or_grade || '—'}

## Summary
${input.summary || ''}

## Skills practiced / tested
${(input.skills_tested || []).map(s => `- ${s}`).join('\n') || '- (to be refined by the educational-researcher)'}

## Gameplay
${input.gameplay || ''}

## Multiplayer model (must not let players disrupt each other's learning)
${input.multiplayer || ''}

## Look & feel
${input.graphics_style || ''}

## Acceptance criteria (testable)
${(input.test_criteria || []).map(s => `- ${s}`).join('\n')}

_Captured by the Game Wizard from a conversation with ${player.username}._
`;
    const id = db.gameReqAdd({
      player_id: player.id, requester: player.username,
      title: String(input.title).slice(0, 120), slug,
      summary: input.summary || '', subject: input.subject || '',
      goal: input.goal || '', requirements,
    });
    // Also drop a requirements.md so the build pipeline can pick it up.
    try {
      const dir = path.join(SPECS_DIR, `${id}-${slug}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'requirements.md'), requirements);
    } catch (e) { /* non-fatal */ }
    return { id, title: input.title };
  }

  // ─── Chat (streamed NDJSON) ──────────────────────────────────────────────────
  router.post('/api/chat', requireAuth, async (req, res) => {
    const apiKey = getKey();
    if (!apiKey) return res.status(503).json({ error: 'The AI helper is not switched on yet. Ask a grown-up to add the key in the teacher dashboard.' });
    const client = new Anthropic({ apiKey });
    const player = req.player;
    const incoming = Array.isArray(req.body.messages) ? req.body.messages : [];
    const messages = incoming
      .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-30)
      .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));
    if (!messages.length || messages[0].role !== 'user') messages.unshift({ role: 'user', content: "Hi! I'd like to make a game." });

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    const send = obj => { res.write(JSON.stringify(obj) + '\n'); };

    try {
      let guard = 0;
      while (guard++ < 4) {
        const stream = client.messages.stream({
          model: MODEL, max_tokens: 2048,
          thinking: { type: 'adaptive' }, output_config: { effort: 'low' },
          system: systemPrompt(player.username),
          tools: [SAVE_TOOL],
          messages,
        });
        stream.on('text', t => send({ type: 'text', text: t }));
        const msg = await stream.finalMessage();
        messages.push({ role: 'assistant', content: msg.content });
        const toolUses = msg.content.filter(b => b.type === 'tool_use');
        if (!toolUses.length) break;
        const results = [];
        for (const tu of toolUses) {
          if (tu.name === 'save_game_request') {
            const saved = saveRequest(player, tu.input || {});
            send({ type: 'saved', id: saved.id, title: saved.title });
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Saved as request #${saved.id}. Now tell ${player.username} in a happy way that their game idea is saved and a grown-up will look at it soon.` });
          } else {
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'unknown tool', is_error: true });
          }
        }
        messages.push({ role: 'user', content: results });
      }
      send({ type: 'done' });
    } catch (e) {
      send({ type: 'error', message: 'Oops — the helper had trouble. Try again in a moment.' });
      console.error('[wizard] chat error:', e.message);
    }
    res.end();
  });

  // ─── The child's own saved ideas ─────────────────────────────────────────────
  router.get('/api/my-requests', requireAuth, (req, res) => res.json(db.gameReqForPlayer(req.player.id)));

  router.get('/api/status', (req, res) => res.json({ aiEnabled: !!getKey(), model: MODEL }));

  return { router };
};
