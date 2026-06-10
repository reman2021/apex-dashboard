import { App, TFile } from 'obsidian';
import type { TrackerDataPoint } from './types';

export function readTrackerData(
	app: App,
	journalPath: string,
	key: string,
	days: number,
): TrackerDataPoint[] {
	const points: TrackerDataPoint[] = [];
	const now = new Date();

	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(now);
		d.setDate(d.getDate() - i);
		const dateStr = formatDateString(d);
		const filePath = journalPath ? `${journalPath}/${dateStr}.md` : `${dateStr}.md`;

		const file = app.vault.getFileByPath(filePath);
		if (!file) {
			points.push({ date: dateStr, value: null });
			continue;
		}

		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm || !(key in fm)) {
			points.push({ date: dateStr, value: null });
			continue;
		}

		const raw = fm[key];
		const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
		points.push({ date: dateStr, value: isNaN(num) ? null : num });
	}

	return points;
}

export function readAllFrontmatterTrackerData(
	app: App,
	key: string,
	days: number,
): TrackerDataPoint[] {
	const buckets = new Map<string, { sum: number; count: number }>();
	const start = startOfDay(new Date());
	start.setDate(start.getDate() - days + 1);
	const end = startOfDay(new Date());

	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (!fm || !(key in fm)) continue;

		const raw = fm[key];
		const num = typeof raw === 'number' ? raw : parseFloat(String(raw));
		if (isNaN(num)) continue;

		const date = getFrontmatterRecordDate(file, fm);
		if (date < start || date > end) continue;

		const dateStr = formatDateString(date);
		const bucket = buckets.get(dateStr) ?? { sum: 0, count: 0 };
		bucket.sum += num;
		bucket.count++;
		buckets.set(dateStr, bucket);
	}

	const points: TrackerDataPoint[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const d = new Date(end);
		d.setDate(end.getDate() - i);
		const dateStr = formatDateString(d);
		const bucket = buckets.get(dateStr);
		points.push({
			date: dateStr,
			value: bucket ? Number((bucket.sum / bucket.count).toFixed(2)) : null,
		});
	}

	return points;
}

export function suggestTrackerKeys(app: App, journalPath?: string): string[] {
	const keys = new Set<string>();

	let files = app.vault.getMarkdownFiles();

	if (journalPath) {
		files = files.filter(f => f.path.startsWith(journalPath + '/'));
	}

	files = files.sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 20);

	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		const fm = cache?.frontmatter;
		if (fm) {
			for (const k of Object.keys(fm)) {
				if (typeof fm[k] === 'number' || !isNaN(parseFloat(String(fm[k])))) {
					keys.add(k);
				}
			}
		}
	}

	return [...keys].sort();
}

function getFrontmatterRecordDate(file: TFile, fm: Record<string, unknown>): Date {
	const candidates = [fm.date, fm.created, fm.createdAt, fm.day];
	for (const candidate of candidates) {
		const date = parseDateCandidate(candidate);
		if (date) return date;
	}

	const pathDate = file.path.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
	if (pathDate) {
		const [, y, m, d] = pathDate;
		return new Date(Number(y), Number(m) - 1, Number(d));
	}

	return startOfDay(new Date(file.stat.mtime));
}

function parseDateCandidate(value: unknown): Date | null {
	if (value instanceof Date && !isNaN(value.getTime())) return startOfDay(value);
	if (typeof value !== 'string' && typeof value !== 'number') return null;

	const text = String(value).trim();
	const match = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
	if (match) {
		const [, y, m, d] = match;
		return new Date(Number(y), Number(m) - 1, Number(d));
	}

	const parsed = new Date(text);
	return isNaN(parsed.getTime()) ? null : startOfDay(parsed);
}

function startOfDay(date: Date): Date {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	return d;
}

function formatDateString(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}
