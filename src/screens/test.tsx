// src/screens/test.tsx
import React, { useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Share,
} from 'react-native';

import DocumentPicker, { types as DocTypes } from 'react-native-document-picker';
import RNFS from 'react-native-fs';
import BlobUtil from 'react-native-blob-util';
import Clipboard from '@react-native-clipboard/clipboard';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

type ProductRow = Record<string, any>;
type StatsRow = Record<string, any>;

const RAMEN_KEYS = ['花', '月', '雪', '月花', '雪月', '雪月花', '花こふれ', 'カレーラーメン', '氷花'] as const;
type RamenKey = typeof RAMEN_KEYS[number];
const RAMEN_LABELS: Record<RamenKey, string> = {
  花: '花',
  月: '月（ランチ）',
  雪: '雪（ランチ）',
  月花: '月花',
  雪月: '雪月',
  雪月花: '雪月花',
  花こふれ: '花こふれ',
  カレーラーメン: 'カレーラーメン',
  氷花: '氷花',
};
const RAMEN_DISPLAY_ORDER: ReadonlyArray<RamenKey> = ['雪', '月', '花', '月花', '雪月', '雪月花', '花こふれ', 'カレーラーメン', '氷花'];
const SET_ALLOWED_KEYS: ReadonlyArray<RamenKey> = ['花', '月花', '雪月'];

type Totals = Record<RamenKey, number>;
type SetTotals = Record<RamenKey, number>;

type PickedFile = { uri: string; name?: string; type?: string | null };
type OtherPayment = { label: string; amount: number };
type CoursePeopleEntry = { label: string; price: number; count: number };
type UnassignedItem = { name: string; count: number };

type PaymentKey = 'total' | 'card' | 'tablecheck' | 'paypay' | 'cash' | 'funfo';
const PAYMENT_KEY_ORDER: readonly PaymentKey[] = ['total', 'card', 'tablecheck', 'paypay', 'cash', 'funfo'];
const PAYMENT_LABELS: Record<PaymentKey, string> = {
  total: '売上',
  card: 'クレジット・IC（Square）',
  tablecheck: 'Table check',
  paypay: 'PayPay',
  cash: '現金',
  funfo: 'Funfo',
};

// total は「税込み」だけ（税抜/非課税/割引前は除外）
const PAYMENT_ALIASES: Record<PaymentKey, string[]> = {
  total: ['売上高（税込み）', '売上高 (税込み)', '売上高 (税込)', '税込み売上高', '税込売上'],
  card: ['Square', 'square', 'クレジット・IC', 'クレジット・IC（Square）', 'クレジット･IC'],
  tablecheck: ['Table check', 'TableCheck', 'テーブルチェック'],
  paypay: ['PayPay', 'paypay', 'Pay Pay'],
  cash: ['現金', 'cash', 'Cash', 'CASH'],
  funfo: ['Funfo', 'fnfo', 'FNFO', 'Fnfo'],
};

const EXTRA_PAYMENT_IGNORE = [
  '会計数', '組数', 'groups', 'group count',
  '客数', '来客数', '人数', 'customers',
];

// 商品名・数量・カテゴリの候補キー
const PRODUCT_NAME_CANDS = ['商品名', '品名', 'メニュー', '商品', 'Item Name', 'item', 'name'];
const PRODUCT_QTY_CANDS = ['商品販売数', '販売数', '数量', '個数', 'Quantity', 'Qty'];
const PRODUCT_CATEGORY_CANDS = ['カテゴリ', 'カテゴリー', 'category', 'Category'];
const GROUP_CANDS = ['会計数', '組数', 'groups', 'group count'];
const PEOPLE_CANDS = ['客数', '来客数', '人数', 'customers'];

// コース・クラファン・人数抽出
const DINNER_PATTERN = /(ディナー|dinner)/i;
const CROWDFUND_PATTERN = /クラファン/i;
const NAME_PEOPLE_PATTERN = /(\d+)名/;
const PRICE_PATTERN = /(\d{4,5})/;

// 「ラーメン『花』or『月花』…セット…」は自動計上せず、未振り分けへ（手動で 花/月花(セット) 選択）
const FORCE_AMBIG_SET_HANA_GEKKA = /ラーメン.*(?:「|『)?花(?:」|』)?\s*or\s*(?:「|『)?月花(?:」|』)?.*セット/i;

// 完全除外（どこにも出さない）— 例：月花コース
const EXCLUDED_PRODUCT_REGEXPS: RegExp[] = [
  /月花.*コース/i,
];

const norm = (s: string) => String(s ?? '').replace(/\u00A0/g, ' ').trim().toLowerCase();
const toNum = (v: any): number => {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[,\s]/g, '');
  const m = s.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
};
const firstByCandidates = (row: Record<string, any>, candidates: string[]) => {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const hit = keys.find(k => norm(k) === norm(cand));
    if (hit) return toNum(row[hit]);
  }
  return 0;
};
const firstKeyStr = (row: Record<string, any>, candidates: string[]) => {
  const keys = Object.keys(row);
  for (const cand of candidates) {
    const hit = keys.find(k => norm(k) === norm(cand));
    if (hit) return String(row[hit] ?? '');
  }
  return '';
};

const jpCurrency = (n: number) => '¥' + Number(n ?? 0).toLocaleString('ja-JP');
const jpDateLabel = (isoDate: string) => {
  const d = new Date(isoDate + 'T00:00:00+09:00');
  const weekday = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'][d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日（${weekday}）`;
};

// ramen detection
const isRamenish = (name: string) => /ラーメン|らーめん|麺|ramen/i.test(name);
const isYokubariCurry = (name: string) => /よくばり.*カレー/i.test(name);
const isPattyCurry = (name: string) => /(パティ|ﾊﾟﾃｨ).*(カレー|ｶﾚｰ)/i.test(name);
const guessRamenKey = (raw: string): RamenKey | undefined => {
  const name = String(raw);
  if (/雪月花|setsugekka/i.test(name)) return '雪月花';
  if (/雪月|setsugetsu/i.test(name)) return '雪月';
  if (/月花|gekka/i.test(name)) return '月花';
  if (/氷花|hyouka|hyoka|ice\s*hana/i.test(name)) return '氷花';
  if (/花こふれ|hana\s*cof+ret|hana\s*coffret/i.test(name)) return '花こふれ';
  if (/(?:カレー|curry).*(?:ラーメン|らーめん|ramen)/i.test(name)) return 'カレーラーメン';
  if (/豆乳ラーメン「?花|(?:^|\s)花(?:」|$)|\bhana\b/i.test(name)) return '花';
  if (/(?:「|^|\s)月(?:」|$)|\btsuki\b/i.test(name)) return '月';
  if (/(?:「|^|\s)雪(?:」|$)|\byuki\b/i.test(name)) return '雪';
  return undefined;
};

const makeEmptyTotals = (): Totals => {
  const totals = {} as Totals;
  RAMEN_KEYS.forEach(k => (totals[k] = 0));
  return totals;
};
const makeEmptySetTotals = (): SetTotals => makeEmptyTotals();

const buildPaymentAliasMap = () => {
  const map = new Map<string, PaymentKey>();
  PAYMENT_KEY_ORDER.forEach(key => {
    PAYMENT_ALIASES[key].forEach(alias => map.set(norm(alias), key));
  });
  return map;
};

type MetaState = {
  dateISO: string;
  payments: Record<PaymentKey, number>;
  otherPayments: OtherPayment[];
  groups: number;
  people: number;
  yokubariCurry: number;
  pattyCurry: number;
};

const renderOutput = (
  meta: MetaState,
  ramenTotals: Totals,
  ramenSetTotals: SetTotals,
  ramenCourseTotals: SetTotals,
  coursePeople: CoursePeopleEntry[],
  unassignedCount: number
) => {
  const lines: string[] = [];
  const pushBlank = () => {
    if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
  };

  // 1) 日付
  lines.push(jpDateLabel(meta.dateISO));

  // 2) 支払（0円は非表示）
  const paymentLines: string[] = [];
  PAYMENT_KEY_ORDER.forEach(key => {
    const amount = meta.payments[key];
    if (amount > 0) paymentLines.push(`${PAYMENT_LABELS[key]}　${jpCurrency(amount)}`);
  });
  meta.otherPayments.forEach(({ label, amount }) => {
    if (amount > 0) paymentLines.push(`${label}　${jpCurrency(amount)}`);
  });
  if (paymentLines.length) {
    pushBlank();
    lines.push(...paymentLines);
  }

  // 3) 組数・人数（存在時のみ）
  const gp: string[] = [];
  if (meta.groups > 0) gp.push(`${meta.groups}組`);
  if (meta.people > 0) gp.push(`${meta.people}人`);
  if (gp.length) {
    pushBlank();
    lines.push(...gp);
  }

  // 4) ラーメン（合計1以上のときだけ）
  const ramenTotalCount = RAMEN_KEYS.reduce(
    (s, k) => s + ramenTotals[k] + ramenSetTotals[k] + ramenCourseTotals[k],
    0
  );
  if (ramenTotalCount > 0) {
    pushBlank();
    lines.push(`ラーメン  ${ramenTotalCount}杯`);
    RAMEN_DISPLAY_ORDER.forEach(key => {
      const base = ramenTotals[key];
      const setCount = ramenSetTotals[key];
      const courseCount = ramenCourseTotals[key];
      const total = base + setCount + courseCount;
      if (total <= 0) return;
      const noteParts: string[] = [];
      if (setCount > 0) noteParts.push(`+セット${setCount}杯`);
      if (courseCount > 0) noteParts.push(`+コース${courseCount}杯`);
      const note = noteParts.length ? `(${noteParts.join(', ')})` : '';
      lines.push(`・${RAMEN_LABELS[key]}　${total}杯${note}`);
    });
  }

  // 5) サイド（独立・1以上のみ・単位は杯）
  const sides: string[] = [];
  if (meta.yokubariCurry > 0) sides.push(`よくばりカレー　${meta.yokubariCurry}杯`);
  if (meta.pattyCurry > 0) sides.push(`パティカレー　${meta.pattyCurry}杯`);
  if (sides.length) {
    pushBlank();
    lines.push(...sides);
  }

  // 6) 人数コース（末尾）
  if (coursePeople.length) {
    pushBlank();
    coursePeople.forEach(({ label, price, count }) => {
      if (!count || count <= 0) return;
      const labelWithPrice = price > 0 ? `${label}${price}` : label;
      lines.push(`${labelWithPrice} ${count}名`);
    });
  }

  // 7) 未振り分け
  if (unassignedCount > 0) {
    pushBlank();
    lines.push(`（要振り分け候補：未計上 ${unassignedCount} 件）`);
  }

  return lines.join('\n');
};

async function pickOne(_kind: 'product' | 'stats'): Promise<PickedFile | null> {
  try {
    const res = await DocumentPicker.pickSingle({
      type: [DocTypes.csv, DocTypes.plainText, 'text/comma-separated-values', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      copyTo: 'cachesDirectory',
      presentationStyle: 'fullScreen',
    });
    const uri = res.fileCopyUri || res.uri;
    return { uri, name: res.name || (res as any).fileName || 'selected.csv', type: res.type ?? (res as any).type ?? null };
  } catch (e: any) {
    if (DocumentPicker.isCancel(e)) return null;
    console.error(e);
    Alert.alert('選択エラー', e?.message ?? String(e));
    return null;
  }
}

async function readText(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    const r = await fetch(uri);
    if (!r.ok) throw new Error('CSVの読み込みに失敗（web）');
    return await r.text();
  }
  if (uri.startsWith('content://')) {
    return await BlobUtil.fs.readFile(uri, 'utf8');
  }
  const path = uri.startsWith('file://') ? uri.replace('file://', '') : uri;
  return await RNFS.readFile(path, 'utf8');
}

const EXCEL_MIME_TYPES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

const isExcelFile = (file: PickedFile) => {
  const name = file.name?.toLowerCase() ?? '';
  const mime = file.type?.toLowerCase() ?? '';
  if (/\.(xlsx|xls)$/i.test(name)) return true;
  if (!mime) return false;
  if (EXCEL_MIME_TYPES.has(mime)) return true;
  return mime.includes('spreadsheetml');
};

async function readExcelRows(file: PickedFile): Promise<Record<string, any>[]> {
  let workbook: XLSX.WorkBook;
  if (Platform.OS === 'web') {
    const response = await fetch(file.uri);
    if (!response.ok) throw new Error('Excel/CSVの読み込みに失敗（web）');
    const arrayBuffer = await response.arrayBuffer();
    workbook = XLSX.read(arrayBuffer, { type: 'array' });
  } else if (file.uri.startsWith('content://')) {
    const base64 = await BlobUtil.fs.readFile(file.uri, 'base64');
    workbook = XLSX.read(base64, { type: 'base64' });
  } else {
    const path = file.uri.startsWith('file://') ? file.uri.replace('file://', '') : file.uri;
    const base64 = await RNFS.readFile(path, 'base64');
    workbook = XLSX.read(base64, { type: 'base64' });
  }
  const sheetName = workbook.SheetNames?.[0];
  if (!sheetName) return [];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(sheet, { defval: '' });
}

export default function TestPageScreen() {
  const [productFile, setProductFile] = useState<PickedFile | null>(null);
  const [statsFile, setStatsFile] = useState<PickedFile | null>(null);
  const [unassigned, setUnassigned] = useState<UnassignedItem[]>([]);
  const [ramenTotals, setRamenTotals] = useState<Totals>(makeEmptyTotals());
  const [ramenSetTotals, setRamenSetTotals] = useState<SetTotals>(makeEmptySetTotals());
  const [ramenCourseTotals, setRamenCourseTotals] = useState<SetTotals>(makeEmptySetTotals());
  const [coursePeopleEntries, setCoursePeopleEntries] = useState<CoursePeopleEntry[]>([]);
  const [meta, setMeta] = useState<MetaState>({
    dateISO: new Date().toISOString().slice(0, 10),
    payments: { total: 0, card: 0, tablecheck: 0, paypay: 0, cash: 0, funfo: 0 },
    otherPayments: [],
    groups: 0,
    people: 0,
    yokubariCurry: 0,
    pattyCurry: 0,
  });

  const output = useMemo(
    () =>
      renderOutput(
        meta,
        ramenTotals,
        ramenSetTotals,
        ramenCourseTotals,
        coursePeopleEntries,
        unassigned.length
      ),
    [meta, ramenTotals, ramenSetTotals, ramenCourseTotals, coursePeopleEntries, unassigned.length]
  );

  const onPick = async (kind: 'product' | 'stats') => {
    const picked = await pickOne(kind);
    if (!picked) return;
    if (kind === 'product') setProductFile(picked);
    else setStatsFile(picked);
  };

  const parseCsv = (text: string) => {
    const { data } = Papa.parse(text, { header: true, skipEmptyLines: true });
    return data as any[];
  };

  const readRows = async (file: PickedFile) => {
    if (isExcelFile(file)) {
      return await readExcelRows(file);
    }
    const text = await readText(file.uri);
    return parseCsv(text);
  };

  const makeSummary = async () => {
    try {
      if (!productFile || !statsFile) {
        Alert.alert('不足', '「商品別 CSV/Excel」と「支払方法別 CSV/Excel」を両方選んでください。');
        return;
      }
      const [productRowsRaw, statsRowsRaw] = await Promise.all([
        readRows(productFile),
        readRows(statsFile),
      ]);
      const productRows = productRowsRaw as ProductRow[];
      const statsRows = statsRowsRaw as StatsRow[];
      if (!statsRows.length) throw new Error('売上詳細CSVに行がありません。');

      const dayRow = statsRows[0];

      // ===== 支払 正規化 =====
      const payments: Record<PaymentKey, number> = { total: 0, card: 0, tablecheck: 0, paypay: 0, cash: 0, funfo: 0 };
      const aliasMap = buildPaymentAliasMap();

      // other に入れないキー（合計・既知決済・集客・税/割引/内訳など）
      const ignoreSet = new Set<string>();
      aliasMap.forEach((_v, k) => ignoreSet.add(k));
      PAYMENT_KEY_ORDER.forEach(k => ignoreSet.add(norm(PAYMENT_LABELS[k])));
      EXTRA_PAYMENT_IGNORE.forEach(l => ignoreSet.add(norm(l)));
      [
        '集計期間',
        '割引前 売上高',
        '売上高（税抜き）',
        '売上高（非課税）',
        '内消費税（合計）',
        '内消費税（10%標準）',
        '内消費税（8%軽減）',
        '売上高（10%標準）',
        '売上高（8%軽減）',
        '会計単価',
        '客単価',
        '商品販売数',
        // 追加の割引用語
        '割引合計_1',
        '会計割引',
        '割引合計',
        '割引',
      ].forEach(l => ignoreSet.add(norm(l)));

      const otherPayments: OtherPayment[] = [];
      Object.entries(dayRow).forEach(([rawKey, rawValue]) => {
        const amount = toNum(rawValue);
        if (!amount) return;
        const nk = norm(rawKey);
        const pkey = aliasMap.get(nk);
        // total はここで加算しない（後で税込み1本だけ採用）
        if (pkey && pkey !== 'total') {
          payments[pkey] += amount;
          return;
        }
        if (ignoreSet.has(nk)) return;
        otherPayments.push({ label: rawKey, amount });
      });

      // 税込み合計の先頭ヒットだけを total に採用
      const pickFirst = (row: Record<string, any>, cands: string[]) =>
        cands.map(c => firstByCandidates(row, [c])).find(v => v > 0) ?? 0;
      const fixedTotal = pickFirst(dayRow, PAYMENT_ALIASES.total);
      if (fixedTotal) payments.total = fixedTotal;

      // ===== 集客 =====
      const groups = firstByCandidates(dayRow, GROUP_CANDS);
      const people = firstByCandidates(dayRow, PEOPLE_CANDS);

      // ===== 日付 =====
      const statsName = statsFile?.name ?? '';
      const prodName = productFile?.name ?? '';
      const dateISOFromCol = String(dayRow['集計期間'] ?? '').match(/^\d{4}-\d{2}-\d{2}/)?.[0];
      const dateISOFromStatsName = (() => {
        const m = String(statsName).match(/(20\d{2})年?0?(\d{1,2})月?0?(\d{1,2})日?/);
        return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}` : undefined;
      })();
      const dateISOFromProdName = (() => {
        const m = String(prodName).match(/(20\d{2})年?0?(\d{1,2})月?0?(\d{1,2})日?/);
        return m ? `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}` : undefined;
      })();
      const dateISO = dateISOFromCol ?? dateISOFromStatsName ?? dateISOFromProdName ?? new Date().toISOString().slice(0, 10);

      // ===== 商品集計：通常/セット/コース、サイド、人数コース =====
      const localTotals = makeEmptyTotals();
      const localSetTotals = makeEmptySetTotals();
      const localCourseTotals = makeEmptySetTotals();
      const ambiguous: UnassignedItem[] = [];
      const coursePeople: CoursePeopleEntry[] = [];
      let yokubariCurry = 0;
      let pattyCurry = 0;

      for (const row of productRows) {
        const name = firstKeyStr(row, PRODUCT_NAME_CANDS);
        const count = firstByCandidates(row, PRODUCT_QTY_CANDS);
        if (!count) continue;

        const category = firstKeyStr(row, PRODUCT_CATEGORY_CANDS);

        // 0) 完全除外（どの集計にも加算しない）
        if (EXCLUDED_PRODUCT_REGEXPS.some(rx => rx.test(name))) {
          continue;
        }

        // 0.5) 「花 or 月花」セットは未振り分けへ（手動でセット/コース配分）
        if (FORCE_AMBIG_SET_HANA_GEKKA.test(name) && /セット|set/i.test(name)) {
          ambiguous.push({ name, count });
          continue;
        }

        // サイド
        if (isYokubariCurry(name)) { yokubariCurry += count; continue; }
        if (isPattyCurry(name)) { pattyCurry += count; continue; }

        // コース：必ず人数コースへ（ラーメン杯に入れない）→ 早期 continue
        const isCourse = /(コース|course)/i.test(name) || /(予約メニュー|予約|コース|course)/i.test(category);
        if (isCourse) {
          const priceMatch = name.match(PRICE_PATTERN);
          const price = priceMatch ? Number(priceMatch[1]) : 0;
          const peopleMatch = name.match(NAME_PEOPLE_PATTERN);
          const peopleCount = peopleMatch ? Number(peopleMatch[1]) : count;
          const label =
            DINNER_PATTERN.test(name) ? 'ディナー' :
            CROWDFUND_PATTERN.test(name) ? 'クラファンコース' : 'コース';
          coursePeople.push({ label, price, count: peopleCount });
          continue;
        }

        // ★ 銘柄判定（銘柄名だけでも拾えるように：先に guess、ダメなら isRamenish で未振り分け）
        const guessed = guessRamenKey(name);
        const isSet = /(セット|set\b)/i.test(name) || /セット/i.test(category);
        if (guessed) {
          if (isSet) localSetTotals[guessed] += count;
          else       localTotals[guessed] += count;
          continue;
        }
        if (isRamenish(name)) {
          ambiguous.push({ name, count });
        }
      }

      setRamenTotals(localTotals);
      setRamenSetTotals(localSetTotals);
      setRamenCourseTotals(localCourseTotals); // 手動で“コース杯”加算可能
      setCoursePeopleEntries(coursePeople);
      setUnassigned(ambiguous);
      setMeta({
        dateISO,
        payments,
        otherPayments,
        groups,
        people,
        yokubariCurry,
        pattyCurry,
      });
    } catch (e: any) {
      console.error(e);
      Alert.alert('エラー', e?.message ?? String(e));
    }
  };

  const assignAllUnassignedToHanaSet = () => {
    if (!unassigned.length) {
      Alert.alert('未振り分けなし', '振り分け候補の項目はありません。');
      return;
    }
    const addCount = unassigned.reduce((s, it) => s + it.count, 0);
    setRamenSetTotals(prev => ({ ...prev, 花: prev.花 + addCount }));
    setUnassigned([]); // まとめ配分後は消す
  };

  const applyAssign = (index: number, key: RamenKey, asSet: boolean, amount?: number) => {
    setUnassigned(prev => {
      const next = [...prev];
      const item = next[index];
      if (!item) return prev;
      const requested = amount ?? item.count;
      const numeric = typeof requested === 'number' && Number.isFinite(requested) ? Math.floor(requested) : item.count;
      const qty = Math.max(0, Math.min(numeric, item.count));
      if (qty <= 0) return prev;

      if (asSet) {
        setRamenSetTotals(prevTotals => ({ ...prevTotals, [key]: prevTotals[key] + qty }));
      } else {
        setRamenTotals(prevTotals => ({ ...prevTotals, [key]: prevTotals[key] + qty }));
      }

      if (qty >= item.count) next.splice(index, 1);
      else next[index] = { ...item, count: item.count - qty };
      return next;
    });
  };

  // ★ コース杯の手動加算（セットと同じUIで「コースに追加」も可能に）
  const applyAssignCourse = (index: number, key: RamenKey, amount?: number) => {
    setUnassigned(prev => {
      const next = [...prev];
      const item = next[index];
      if (!item) return prev;
      const requested = amount ?? item.count;
      const numeric = typeof requested === 'number' && Number.isFinite(requested) ? Math.floor(requested) : item.count;
      const qty = Math.max(0, Math.min(numeric, item.count));
      if (qty <= 0) return prev;

      setRamenCourseTotals(prevTotals => ({ ...prevTotals, [key]: prevTotals[key] + qty }));

      if (qty >= item.count) next.splice(index, 1);
      else next[index] = { ...item, count: item.count - qty };
      return next;
    });
  };

  const onCopy = async () => {
    if (!output) return;
    await Clipboard.setString(output);
    Alert.alert('コピー完了', '日報テキストをクリップボードにコピーしました。');
  };

  const onShare = async () => {
    if (!output) return;
    try {
      await Share.share({ message: output });
    } catch (e) {
      Alert.alert('共有エラー', String(e));
      return;
    }
    try {
      const fileName = `summary_${meta.dateISO}.txt`;
      const path = `${RNFS.DocumentDirectoryPath}/${fileName}`;
      await RNFS.writeFile(path, output, 'utf8');
    } catch {}
  };

  const fileBadge = (f: PickedFile | null, label: string) => (
    <View style={styles.fileRow}>
      <Text style={styles.fileLabel}>{label}</Text>
      <Text style={styles.fileName}>{f?.name ?? '未選択'}</Text>
    </View>
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.h1}>CSV/Excelから日報テキスト生成</Text>

      {fileBadge(productFile, '① 商品別 CSV/Excel')}
      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={() => onPick('product')}>
          <Text style={styles.btnText}>商品別CSV/Excelを選ぶ</Text>
        </Pressable>
      </View>

      {fileBadge(statsFile, '② 支払方法別／拡張統計 CSV/Excel')}
      <View style={styles.row}>
        <Pressable style={styles.btn} onPress={() => onPick('stats')}>
          <Text style={styles.btnText}>支払方法別CSV/Excelを選ぶ</Text>
        </Pressable>
      </View>

      <View style={styles.row}>
        <Pressable style={[styles.btn, styles.primary]} onPress={makeSummary}>
          <Text style={[styles.btnText, styles.primaryText]}>解析して文章を作る</Text>
        </Pressable>
      </View>

      {/* 日付手動調整（JST） */}
      <View style={[styles.row, { justifyContent: 'space-between', alignItems: 'center' }]}>
        <Pressable
          style={[styles.btn, styles.outline, { minWidth: 84, alignItems: 'center' }]}
          onPress={() => {
            const d = new Date(meta.dateISO + 'T00:00:00+09:00');
            d.setDate(d.getDate() - 1);
            setMeta(prev => ({ ...prev, dateISO: d.toISOString().slice(0, 10) }));
          }}
        >
          <Text style={styles.btnText}>← 前日</Text>
        </Pressable>
        <Text style={{ fontSize: 14, fontWeight: '600' }}>{jpDateLabel(meta.dateISO)}</Text>
        <Pressable
          style={[styles.btn, styles.outline, { minWidth: 84, alignItems: 'center' }]}
          onPress={() => {
            const d = new Date(meta.dateISO + 'T00:00:00+09:00');
            d.setDate(d.getDate() + 1);
            setMeta(prev => ({ ...prev, dateISO: d.toISOString().slice(0, 10) }));
          }}
        >
          <Text style={styles.btnText}>翌日 →</Text>
        </Pressable>
      </View>

      <Text style={styles.h2}>出力プレビュー</Text>
      <View style={styles.outputBox}>
        <Text style={styles.mono}>{output || '（ここに生成された文章が表示されます）'}</Text>
      </View>

      <View style={styles.toolbar}>
        <Pressable style={styles.btn} onPress={onCopy} disabled={!output}>
          <Text style={styles.btnText}>コピー</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={onShare} disabled={!output}>
          <Text style={styles.btnText}>テキスト保存/共有</Text>
        </Pressable>
      </View>

      {!!unassigned.length && (
        <View style={styles.unassignedBox}>
          <Text style={styles.warnTitle}>要振り分け候補（未計上）: {unassigned.length}件</Text>
          {unassigned.map((a, i) => (
            <View key={`${a.name}-${i}`} style={styles.unassignedItem}>
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                <Text style={styles.itemName}>・{a.name}</Text>
                <Text style={styles.itemMeta}>× {a.count}</Text>
              </View>

              <Text style={{ marginTop: 6, fontSize: 12 }}>通常に追加（残り {a.count}）</Text>
              <View style={styles.chipRow}>
                {RAMEN_DISPLAY_ORDER.map(key => (
                  <Pressable
                    key={`base-${key}`}
                    style={styles.chip}
                    onPress={() => applyAssign(i, key, false, 1)}
                    onLongPress={() => applyAssign(i, key, false, a.count)}
                    delayLongPress={200}
                  >
                    <Text style={styles.chipText}>＋{RAMEN_LABELS[key]}</Text>
                  </Pressable>
                ))}
              </View>

              <Text style={{ marginTop: 8, fontSize: 12 }}>セットに追加</Text>
              <View style={styles.chipRow}>
                {SET_ALLOWED_KEYS.map(key => (
                  <Pressable
                    key={`set-${key}`}
                    style={[styles.chip, styles.chipSet]}
                    onPress={() => applyAssign(i, key, true, 1)}
                    onLongPress={() => applyAssign(i, key, true, a.count)}
                    delayLongPress={200}
                  >
                    <Text style={styles.chipText}>＋{RAMEN_LABELS[key]}（セット）</Text>
                  </Pressable>
                ))}
              </View>

              {/* ★ 追加：コースに追加 */}
              <Text style={{ marginTop: 8, fontSize: 12 }}>コースに追加</Text>
              <View style={styles.chipRow}>
                {SET_ALLOWED_KEYS.map(key => (
                  <Pressable
                    key={`course-${key}`}
                    style={[styles.chip, styles.chipCourse]}
                    onPress={() => applyAssignCourse(i, key, 1)}
                    onLongPress={() => applyAssignCourse(i, key, a.count)}
                    delayLongPress={200}
                  >
                    <Text style={styles.chipText}>＋{RAMEN_LABELS[key]}（コース）</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          <Pressable style={[styles.btn, styles.outline, { marginTop: 12 }]} onPress={assignAllUnassignedToHanaSet}>
            <Text style={styles.btnText}>未振り分けを一括で「花セット」計上</Text>
          </Pressable>
          <Text style={styles.warnNote}>※タップで1杯、長押しで残数まとめて配分できます。</Text>
        </View>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  h1: { fontSize: 18, fontWeight: '700' },
  h2: { fontSize: 16, fontWeight: '600', marginTop: 8 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  btn: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#f2f2f7' },
  btnText: { fontSize: 14, fontWeight: '600', color: '#111' },
  primary: { backgroundColor: '#007aff' },
  primaryText: { color: '#fff' },
  outline: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#c7c7cc' },
  fileRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fileLabel: { fontSize: 14, color: '#444' },
  fileName: { fontSize: 14, fontWeight: '600' },
  outputBox: {
    padding: 12,
    backgroundColor: '#fbfbfd',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#e5e5ea',
    minHeight: 160,
  },
  mono: {
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'Courier' }),
    fontSize: 14, lineHeight: 20,
  },
  toolbar: { flexDirection: 'row', gap: 12 },
  unassignedBox: {
    marginTop: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#ffd60a',
    backgroundColor: '#fffbea',
  },
  unassignedItem: { marginTop: 8 },
  itemName: { fontSize: 13, fontWeight: '600' },
  itemMeta: { fontSize: 12, color: '#666', marginLeft: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  chip: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#f2f2f7' },
  chipSet: { backgroundColor: '#e7f0ff' },
  chipCourse: { backgroundColor: '#ffe7f0' },
  chipText: { fontSize: 12, fontWeight: '600' },
  warnTitle: { fontWeight: '700', marginBottom: 6 },
  warnNote: { fontSize: 12, color: '#666', marginTop: 6 },
});
