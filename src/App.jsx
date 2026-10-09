import { useState, useMemo, useEffect, useRef } from 'react';
import {
  initialState,
  legalMoves,
  pseudoMoves,
  applyMove,
  toSAN,
  getStatus,
  FILES,
} from './engine';
import './App.css';

const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟︎' };
const VALUE = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
const NAME = { w: 'White', b: 'Black' };
const other = (c) => (c === 'w' ? 'b' : 'w');
const ORDER = [0, 1, 2, 3, 4, 5, 6, 7];

function formatTime(ms) {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function Piece({ code, ...rest }) {
  return (
    <span className={`piece ${code[0] === 'w' ? 'white' : 'black'}`} {...rest}>
      {GLYPH[code[1]]}
    </span>
  );
}

function PlayerBar({ color, captured, advantage, ms, active }) {
  const sorted = [...captured].sort((a, b) => VALUE[b] - VALUE[a]);
  return (
    <div className={`player-bar ${active ? 'active' : ''}`}>
      <div className="player-info">
        <span className={`avatar ${color}`} />
        <div>
          <div className="player-name">{NAME[color]}</div>
          <div className="captured" aria-label={`Pieces captured by ${NAME[color]}`}>
            {sorted.map((t, i) => (
              <span key={i} className={`cap ${other(color) === 'w' ? 'white' : 'black'}`}>
                {GLYPH[t]}
              </span>
            ))}
            {advantage > 0 && <span className="adv">+{advantage}</span>}
          </div>
        </div>
      </div>
      <div className={`clock ${active ? 'running' : ''} ${ms < 30000 ? 'low' : ''}`}>
        {formatTime(ms)}
      </div>
    </div>
  );
}

export default function App() {
  const [game, setGame] = useState(initialState);
  const [history, setHistory] = useState([]); // { before, move, san }
  const [selected, setSelected] = useState(null);
  const [promo, setPromo] = useState(null);
  const [notice, setNotice] = useState(null);
  const [flipped, setFlipped] = useState(false);
  const [minutes, setMinutes] = useState(10);
  const [times, setTimes] = useState({ w: 600000, b: 600000 });
  const [timedOut, setTimedOut] = useState(null);
  const [resigned, setResigned] = useState(null);
  const listRef = useRef(null);

  const legal = useMemo(() => legalMoves(game), [game]);
  const info = useMemo(() => getStatus(game, legal), [game, legal]);

  const over = info.status !== 'playing' || !!timedOut || !!resigned;
  const running = history.length > 0 && !over;

  // ----- outcome text -----
  let outcome = null;
  if (resigned) outcome = `${NAME[resigned]} resigned — ${NAME[other(resigned)]} wins`;
  else if (timedOut) outcome = `${NAME[timedOut]} ran out of time — ${NAME[other(timedOut)]} wins`;
  else if (info.status === 'checkmate') outcome = `Checkmate! ${NAME[info.winner]} wins`;
  else if (info.status === 'stalemate') outcome = 'Stalemate — draw';
  else if (info.status === 'draw') outcome = `Draw — ${info.reason}`;

  // ----- clocks -----
  useEffect(() => {
    if (!running) return undefined;
    const side = game.turn;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      const d = now - last;
      last = now;
      setTimes((t) => ({ ...t, [side]: Math.max(0, t[side] - d) }));
    }, 100);
    return () => clearInterval(id);
  }, [running, game.turn]);

  useEffect(() => {
    if (timedOut) return;
    if (times.w <= 0) setTimedOut('w');
    else if (times.b <= 0) setTimedOut('b');
  }, [times, timedOut]);

  // ----- toast -----
  useEffect(() => {
    if (!notice) return undefined;
    const id = setTimeout(() => setNotice(null), 2600);
    return () => clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [history.length]);

  const notify = (text, type = 'error') => setNotice({ text, type, id: Date.now() });

  // ----- derived board info -----
  const selMoves = useMemo(
    () => (selected ? legal.filter((m) => m.from[0] === selected[0] && m.from[1] === selected[1]) : []),
    [selected, legal]
  );
  const lastMove = history.length ? history[history.length - 1].move : null;
  const kingSquare = useMemo(() => {
    if (!info.check) return null;
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) if (game.board[r][c] === game.turn + 'K') return [r, c];
    return null;
  }, [info.check, game]);

  const captured = useMemo(() => {
    const out = { w: [], b: [] }; // pieces captured BY that colour
    history.forEach((h) => {
      if (h.move.captured) out[h.move.piece[0]].push(h.move.captured[1]);
    });
    return out;
  }, [history]);
  const score = (list) => list.reduce((s, t) => s + VALUE[t], 0);
  const lead = score(captured.w) - score(captured.b);

  // ----- actions -----
  function commit(m) {
    const san = toSAN(game, m, legal);
    const next = applyMove(game, m);
    setHistory((h) => [...h, { before: game, move: m, san }]);
    setGame(next);
    setSelected(null);
    setPromo(null);
    const st = getStatus(next);
    if (st.status === 'playing' && st.check) notify('Check!', 'warn');
  }

  function trySelect(r, c) {
    if (!legal.some((m) => m.from[0] === r && m.from[1] === c)) {
      setSelected(null);
      notify('That piece has no legal moves');
      return;
    }
    setSelected([r, c]);
  }

  function handleSquare(r, c) {
    if (over || promo) return;
    const piece = game.board[r][c];
    const own = piece && piece[0] === game.turn;

    if (selected) {
      const [sr, sc] = selected;
      if (sr === r && sc === c) {
        setSelected(null);
        return;
      }
      const moves = selMoves.filter((m) => m.to[0] === r && m.to[1] === c);
      if (moves.length) {
        if (moves[0].promotion) setPromo(moves);
        else commit(moves[0]);
        return;
      }
      if (own) {
        trySelect(r, c);
        return;
      }
      const wouldBeLegalIgnoringCheck = pseudoMoves(game, sr, sc).some(
        (m) => m.to[0] === r && m.to[1] === c
      );
      notify(
        wouldBeLegalIgnoringCheck
          ? info.check
            ? 'Illegal move — your king is in check'
            : 'Illegal move — it would leave your king in check'
          : 'Illegal move for that piece'
      );
      return;
    }

    if (own) trySelect(r, c);
    else if (piece) notify(`It's ${NAME[game.turn]}'s turn`);
  }

  function undo() {
    if (!history.length || timedOut || resigned) return;
    const last = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setGame(last.before);
    setSelected(null);
    setPromo(null);
    setNotice(null);
  }

  function newGame(mins = minutes) {
    setGame(initialState());
    setHistory([]);
    setSelected(null);
    setPromo(null);
    setNotice(null);
    setTimedOut(null);
    setResigned(null);
    setTimes({ w: mins * 60000, b: mins * 60000 });
  }

  function changeMinutes(e) {
    const mins = Number(e.target.value);
    setMinutes(mins);
    if (history.length === 0) setTimes({ w: mins * 60000, b: mins * 60000 });
  }

  // ----- render -----
  const rows = flipped ? [...ORDER].reverse() : ORDER;
  const cols = rows;
  const topColor = flipped ? 'w' : 'b';
  const bottomColor = other(topColor);

  const movePairs = [];
  for (let i = 0; i < history.length; i += 2) {
    movePairs.push({ n: i / 2 + 1, w: history[i].san, b: history[i + 1]?.san });
  }

  const statusLine = over
    ? outcome
    : info.check
    ? `${NAME[game.turn]} is in check!`
    : `${NAME[game.turn]} to move`;

  const bar = (color) => (
    <PlayerBar
      color={color}
      captured={captured[color]}
      advantage={Math.max(0, color === 'w' ? lead : -lead)}
      ms={times[color]}
      active={!over && game.turn === color}
    />
  );

  return (
    <div className="app">
      <h1 className="title">Chess</h1>
      <div className="layout">
        <div className="board-col">
          {bar(topColor)}

          <div className="board-wrap">
            <div className="board" role="grid" aria-label="Chess board">
              {rows.map((r) =>
                cols.map((c) => {
                  const piece = game.board[r][c];
                  const light = (r + c) % 2 === 0;
                  const target = selMoves.find((m) => m.to[0] === r && m.to[1] === c);
                  const isSel = selected && selected[0] === r && selected[1] === c;
                  const isLast =
                    lastMove &&
                    ((lastMove.from[0] === r && lastMove.from[1] === c) ||
                      (lastMove.to[0] === r && lastMove.to[1] === c));
                  const isCheck = kingSquare && kingSquare[0] === r && kingSquare[1] === c;
                  const draggable = !!piece && piece[0] === game.turn && !over && !promo;
                  return (
                    <div
                      key={`${r}-${c}`}
                      role="gridcell"
                      className={[
                        'sq',
                        light ? 'light' : 'dark',
                        isLast ? 'last' : '',
                        isSel ? 'selected' : '',
                        isCheck ? 'in-check' : '',
                      ].join(' ')}
                      onClick={() => handleSquare(r, c)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        handleSquare(r, c);
                      }}
                    >
                      {c === cols[0] && <span className="coord rank">{8 - r}</span>}
                      {r === rows[7] && <span className="coord file">{FILES[c]}</span>}
                      {piece && (
                        <Piece
                          code={piece}
                          draggable={draggable}
                          onDragStart={(e) => {
                            e.dataTransfer.setData('text/plain', '');
                            handleSquare(r, c);
                          }}
                        />
                      )}
                      {target && <span className={target.captured ? 'ring' : 'dot'} />}
                    </div>
                  );
                })
              )}
            </div>

            {notice && (
              <div key={notice.id} className={`toast ${notice.type}`} role="status">
                {notice.text}
              </div>
            )}

            {promo && (
              <div className="overlay" onClick={() => setPromo(null)}>
                <div className="promo" onClick={(e) => e.stopPropagation()}>
                  <div className="promo-title">Promote pawn to</div>
                  <div className="promo-choices">
                    {promo.map((m) => (
                      <button key={m.promotion} onClick={() => commit(m)} title={m.promotion}>
                        <Piece code={game.turn + m.promotion} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {over && (
              <div className="overlay">
                <div className="gameover">
                  <div className="gameover-title">Game over</div>
                  <div className="gameover-text">{outcome}</div>
                  <button className="btn primary" onClick={() => newGame()}>
                    New game
                  </button>
                </div>
              </div>
            )}
          </div>

          {bar(bottomColor)}
        </div>

        <aside className="side">
          <div className={`status ${info.check && !over ? 'check' : ''} ${over ? 'over' : ''}`}>
            {statusLine}
          </div>
          {history.length === 0 && (
            <div className="hint">Clocks start after White's first move.</div>
          )}

          <div className="moves-card">
            <div className="moves-head">Moves</div>
            <div className="moves" ref={listRef}>
              {movePairs.length === 0 && <div className="empty">No moves yet</div>}
              {movePairs.map((p) => (
                <div className="move-row" key={p.n}>
                  <span className="num">{p.n}.</span>
                  <span className="san">{p.w}</span>
                  <span className="san">{p.b || ''}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="controls">
            <button
              className="btn"
              onClick={undo}
              disabled={!history.length || !!timedOut || !!resigned}
            >
              ↶ Undo
            </button>
            <button className="btn" onClick={() => setFlipped((f) => !f)}>
              ⇅ Flip board
            </button>
            <button
              className="btn"
              onClick={() => setResigned(game.turn)}
              disabled={over || history.length === 0}
            >
              ⚑ Resign
            </button>
            <button className="btn primary" onClick={() => newGame()}>
              New game
            </button>
          </div>

          <label className="time-select">
            Time per player
            <select value={minutes} onChange={changeMinutes}>
              {[1, 3, 5, 10, 15, 30].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
          <div className="hint small">A change applies to the next new game once play has started.</div>
        </aside>
      </div>
    </div>
  );
}