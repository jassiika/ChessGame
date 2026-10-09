export const FILES = 'abcdefgh';

const KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
const KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

const inb = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const colorOf = (p) => p[0];
const typeOf = (p) => p[1];
const opp = (c) => (c === 'w' ? 'b' : 'w');
const fileOf = (c) => FILES[c];
const rankOf = (r) => String(8 - r);

export function initialState() {
  const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  const board = [];
  board.push(back.map((p) => 'b' + p));
  board.push(Array(8).fill('bP'));
  for (let i = 0; i < 4; i++) board.push(Array(8).fill(null));
  board.push(Array(8).fill('wP'));
  board.push(back.map((p) => 'w' + p));
  return {
    board,
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    ep: null,
    halfmove: 0,
  };
}

// Used by the tests to set up well-known positions.
export function fenToState(fen) {
  const [placement, turn, castle = '-', ep = '-', half = '0'] = fen.split(' ');
  const board = placement.split('/').map((row) => {
    const out = [];
    for (const ch of row) {
      if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) out.push(null);
      else out.push((ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase());
    }
    return out;
  });
  return {
    board,
    turn,
    castling: {
      wK: castle.includes('K'),
      wQ: castle.includes('Q'),
      bK: castle.includes('k'),
      bQ: castle.includes('q'),
    },
    ep: ep !== '-' ? [8 - Number(ep[1]), FILES.indexOf(ep[0])] : null,
    halfmove: Number(half) || 0,
  };
}

export function isAttacked(board, r, c, by) {
  // pawns
  const pr = by === 'w' ? r + 1 : r - 1;
  for (const dc of [-1, 1]) {
    if (inb(pr, c + dc) && board[pr][c + dc] === by + 'P') return true;
  }
  // knights
  for (const [dr, dc] of KNIGHT) {
    const nr = r + dr, nc = c + dc;
    if (inb(nr, nc) && board[nr][nc] === by + 'N') return true;
  }
  // king
  for (const [dr, dc] of KING) {
    const nr = r + dr, nc = c + dc;
    if (inb(nr, nc) && board[nr][nc] === by + 'K') return true;
  }
  // sliders
  const slide = (dirs, kinds) => {
    for (const [dr, dc] of dirs) {
      let nr = r + dr, nc = c + dc;
      while (inb(nr, nc)) {
        const p = board[nr][nc];
        if (p) {
          if (colorOf(p) === by && kinds.includes(typeOf(p))) return true;
          break;
        }
        nr += dr;
        nc += dc;
      }
    }
    return false;
  };
  return slide(ROOK_DIRS, ['R', 'Q']) || slide(BISHOP_DIRS, ['B', 'Q']);
}

export function findKing(board, color) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) if (board[r][c] === color + 'K') return [r, c];
  return null;
}

export function inCheck(state, color = state.turn) {
  const k = findKing(state.board, color);
  return k ? isAttacked(state.board, k[0], k[1], opp(color)) : false;
}

// Moves a piece could make ignoring whether they leave its own king in check.
export function pseudoMoves(state, r, c) {
  const { board } = state;
  const piece = board[r][c];
  if (!piece) return [];
  const col = colorOf(piece);
  const t = typeOf(piece);
  const moves = [];
  const add = (tr, tc, extra = {}) =>
    moves.push({ from: [r, c], to: [tr, tc], piece, captured: board[tr][tc] || null, ...extra });

  if (t === 'P') {
    const dir = col === 'w' ? -1 : 1;
    const startRow = col === 'w' ? 6 : 1;
    const promoRow = col === 'w' ? 0 : 7;
    const addPawn = (tr, tc, extra = {}) => {
      if (tr === promoRow) for (const p of ['Q', 'R', 'B', 'N']) add(tr, tc, { ...extra, promotion: p });
      else add(tr, tc, extra);
    };
    const one = r + dir;
    if (inb(one, c) && !board[one][c]) {
      addPawn(one, c);
      if (r === startRow && !board[r + 2 * dir][c]) add(r + 2 * dir, c, { double: true });
    }
    for (const dc of [-1, 1]) {
      const nc = c + dc;
      if (!inb(one, nc)) continue;
      const target = board[one][nc];
      if (target && colorOf(target) !== col) addPawn(one, nc);
      else if (!target && state.ep && state.ep[0] === one && state.ep[1] === nc)
        add(one, nc, { enPassant: true, captured: opp(col) + 'P' });
    }
  } else if (t === 'N' || t === 'K') {
    for (const [dr, dc] of t === 'N' ? KNIGHT : KING) {
      const nr = r + dr, nc = c + dc;
      if (!inb(nr, nc)) continue;
      const target = board[nr][nc];
      if (!target || colorOf(target) !== col) add(nr, nc);
    }
    if (t === 'K' && c === 4 && r === (col === 'w' ? 7 : 0)) {
      const enemy = opp(col);
      const safe = (cc) => !isAttacked(board, r, cc, enemy);
      if (
        state.castling[col + 'K'] && !board[r][5] && !board[r][6] &&
        board[r][7] === col + 'R' && safe(4) && safe(5) && safe(6)
      ) add(r, 6, { castle: 'K' });
      if (
        state.castling[col + 'Q'] && !board[r][1] && !board[r][2] && !board[r][3] &&
        board[r][0] === col + 'R' && safe(4) && safe(3) && safe(2)
      ) add(r, 2, { castle: 'Q' });
    }
  } else {
    const dirs = t === 'R' ? ROOK_DIRS : t === 'B' ? BISHOP_DIRS : [...ROOK_DIRS, ...BISHOP_DIRS];
    for (const [dr, dc] of dirs) {
      let nr = r + dr, nc = c + dc;
      while (inb(nr, nc)) {
        const target = board[nr][nc];
        if (!target) add(nr, nc);
        else {
          if (colorOf(target) !== col) add(nr, nc);
          break;
        }
        nr += dr;
        nc += dc;
      }
    }
  }
  return moves;
}

const CORNER_RIGHTS = { '7,0': 'wQ', '7,7': 'wK', '0,0': 'bQ', '0,7': 'bK' };

export function applyMove(state, m) {
  const board = state.board.map((row) => row.slice());
  const [fr, fc] = m.from;
  const [tr, tc] = m.to;
  const piece = board[fr][fc];
  const col = colorOf(piece);

  board[fr][fc] = null;
  board[tr][tc] = m.promotion ? col + m.promotion : piece;
  if (m.enPassant) board[fr][tc] = null;
  if (m.castle === 'K') { board[tr][5] = board[tr][7]; board[tr][7] = null; }
  if (m.castle === 'Q') { board[tr][3] = board[tr][0]; board[tr][0] = null; }

  const castling = { ...state.castling };
  if (typeOf(piece) === 'K') { castling[col + 'K'] = false; castling[col + 'Q'] = false; }
  const a = CORNER_RIGHTS[`${fr},${fc}`];
  const b = CORNER_RIGHTS[`${tr},${tc}`];
  if (a) castling[a] = false;
  if (b) castling[b] = false;

  return {
    board,
    turn: opp(state.turn),
    castling,
    ep: m.double ? [(fr + tr) / 2, fc] : null,
    halfmove: typeOf(piece) === 'P' || m.captured ? 0 : state.halfmove + 1,
  };
}

export function legalMoves(state) {
  const out = [];
  const col = state.turn;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (!p || colorOf(p) !== col) continue;
      for (const m of pseudoMoves(state, r, c)) {
        if (!inCheck(applyMove(state, m), col)) out.push(m);
      }
    }
  }
  return out;
}

function insufficientMaterial(board) {
  const rest = [];
  for (const row of board) for (const p of row) if (p && typeOf(p) !== 'K') rest.push(typeOf(p));
  if (rest.length === 0) return true;
  if (rest.length === 1 && (rest[0] === 'B' || rest[0] === 'N')) return true;
  return false;
}

export function getStatus(state, moves = legalMoves(state)) {
  const check = inCheck(state);
  if (moves.length === 0) {
    return check
      ? { status: 'checkmate', check, winner: opp(state.turn) }
      : { status: 'stalemate', check, reason: 'Stalemate' };
  }
  if (insufficientMaterial(state.board)) return { status: 'draw', check, reason: 'Insufficient material' };
  if (state.halfmove >= 100) return { status: 'draw', check, reason: '50-move rule' };
  return { status: 'playing', check };
}

// Standard algebraic notation for a legal move in `state`.
export function toSAN(state, m, legal = legalMoves(state)) {
  const [fr, fc] = m.from;
  const [tr, tc] = m.to;
  let san;
  if (m.castle) {
    san = m.castle === 'K' ? 'O-O' : 'O-O-O';
  } else {
    const t = typeOf(m.piece);
    san = '';
    if (t !== 'P') {
      san += t;
      const others = legal.filter(
        (o) => o !== m && o.piece === m.piece && o.to[0] === tr && o.to[1] === tc &&
          !(o.from[0] === fr && o.from[1] === fc)
      );
      if (others.length) {
        const sameFile = others.some((o) => o.from[1] === fc);
        const sameRank = others.some((o) => o.from[0] === fr);
        if (!sameFile) san += fileOf(fc);
        else if (!sameRank) san += rankOf(fr);
        else san += fileOf(fc) + rankOf(fr);
      }
    } else if (m.captured) {
      san += fileOf(fc);
    }
    if (m.captured) san += 'x';
    san += fileOf(tc) + rankOf(tr);
    if (m.promotion) san += '=' + m.promotion;
  }
  const st = getStatus(applyMove(state, m));
  if (st.status === 'checkmate') san += '#';
  else if (st.check) san += '+';
  return san;
}

export function perft(state, depth) {
  if (depth === 0) return 1;
  const moves = legalMoves(state);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(applyMove(state, m), depth - 1);
  return n;
}