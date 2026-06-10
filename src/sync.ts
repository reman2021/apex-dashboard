import { App, TAbstractFile, TFile } from 'obsidian';
import type { DashboardSettings, DashboardCard, DashboardData, TaskItem, QuickAction, BannerData, CardType } from './types';
import { parse, serialize, generateDefaultMarkdown } from './parser';
import { t } from './i18n';

type DataCallback = (data: DashboardData) => void;

const KNOWN_METADATA_KEYS = new Set(['link', 'progress', 'due', 'streak', 'type']);

export class SyncEngine {
	private app: App;
	private settings: DashboardSettings;
	private file: TFile | null = null;
	private data: DashboardData | null = null;
	private lastWrittenHash = '';
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly debounceMs = 300;
	private writeQueue: Promise<void> = Promise.resolve();
	private callbacks: DataCallback[] = [];
	private eventRef: ReturnType<typeof this.app.vault.on> | null = null;
	private static readonly BACKUP_DIR = '.dashboard-backup';
	private static readonly MAX_BACKUPS = 5;

	constructor(app: App, settings: DashboardSettings) {
		this.app = app;
		this.settings = settings;
	}

	updateSettings(settings: DashboardSettings): void {
		this.settings = settings;
	}

	onDataUpdate(cb: DataCallback): void {
		this.callbacks.push(cb);
	}

	async init(): Promise<void> {
		await this.findOrCreateFile();
		this.registerFileWatcher();
		await this.load();
	}

	destroy(): void {
		if (this.eventRef) {
			this.app.vault.offref(this.eventRef);
			this.eventRef = null;
		}
		if (this.renameEventRef) {
			this.app.vault.offref(this.renameEventRef);
			this.renameEventRef = null;
		}
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
		}
		if (this.deferredWriteTimer) {
			clearTimeout(this.deferredWriteTimer);
		}
	}

	getData(): DashboardData | null {
		return this.data;
	}

	async refresh(): Promise<void> {
		await this.load();
	}

	async toggleTask(cardId: string, taskIndex: number, checked: boolean): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col => ({
				...col,
				cards: col.cards.map(card => {
					if (card.id !== cardId) return card;
					if (taskIndex >= card.tasks.length) return card;
					const newTasks: TaskItem[] = card.tasks.map((t, i) =>
						i === taskIndex ? { ...t, checked } : t
					);
					if (checked) {
						const [moved] = newTasks.splice(taskIndex, 1);
						newTasks.push(moved!);
					}
					return { ...card, tasks: newTasks };
				}),
			})),
		};
		await this.writeToDisk();
	}

	async reorderTask(cardId: string, fromIndex: number, toIndex: number): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col => ({
				...col,
				cards: col.cards.map(card => {
					if (card.id !== cardId) return card;
					if (fromIndex < 0 || fromIndex >= card.tasks.length) return card;
					if (toIndex < 0 || toIndex >= card.tasks.length) return card;
					const tasks = [...card.tasks];
					const moved = tasks[fromIndex]!;
					tasks.splice(fromIndex, 1);
					tasks.splice(toIndex, 0, moved);
					return { ...card, tasks };
				}),
			})),
		};
		await this.writeToDisk();
	}

	async moveTaskToCard(srcCardId: string, taskIndex: number, destCardId: string, destIndex: number): Promise<void> {
		if (!this.data) return;

		let movedTask: TaskItem | undefined;

		const columnsWithout = this.data.columns.map(col => ({
			...col,
			cards: col.cards.map(card => {
				if (card.id !== srcCardId) return card;
				if (taskIndex < 0 || taskIndex >= card.tasks.length) return card;
				movedTask = card.tasks[taskIndex];
				return { ...card, tasks: card.tasks.filter((_, i) => i !== taskIndex) };
			}),
		}));

		if (!movedTask) return;

		this.data = {
			...this.data,
			columns: columnsWithout.map(col => ({
				...col,
				cards: col.cards.map(card => {
					if (card.id !== destCardId) return card;
					const tasks = [...card.tasks];
					const clamped = Math.min(destIndex, tasks.length);
					tasks.splice(clamped, 0, movedTask!);
					return { ...card, tasks };
				}),
			})),
		};
		await this.writeToDisk();
	}

	async editTask(cardId: string, taskIndex: number, newText: string): Promise<void> {
		if (!this.data || !newText) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col => ({
				...col,
				cards: col.cards.map(card => {
					if (card.id !== cardId) return card;
					if (taskIndex >= card.tasks.length) return card;
					const tasks = card.tasks.map((t, i) => i === taskIndex ? { ...t, text: newText } : t);
					return { ...card, tasks };
				}),
			})),
		};
		await this.writeToDisk();
	}

	async addTask(cardId: string, text: string): Promise<void> {
		if (!this.data || !text.trim()) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col => ({
				...col,
				cards: col.cards.map(card => {
					if (card.id !== cardId) return card;
					return { ...card, tasks: [...card.tasks, { text: text.trim(), checked: false }] };
				}),
			})),
		};
		await this.writeToDisk();
	}

	async deleteTask(cardId: string, taskIndex: number): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col => ({
				...col,
				cards: col.cards.map(card => {
					if (card.id !== cardId) return card;
					if (taskIndex >= card.tasks.length) return card;
					const newTasks = card.tasks.filter((_, i) => i !== taskIndex);
					return { ...card, tasks: newTasks };
				}),
			})),
		};
		await this.writeToDisk();
	}

	async updateCard(cardId: string, updates: Partial<Pick<DashboardCard, 'title' | 'body' | 'dueDate' | 'color' | 'coverImage' | 'archived' | 'archivedAt' | 'width' | 'size' | 'gridCols' | 'gridRows' | 'gridCol' | 'gridRow'>>): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col => ({
				...col,
				cards: col.cards.map(card =>
					card.id === cardId ? { ...card, ...updates } : card
				),
			})),
		};
		await this.writeToDisk();
	}

	async editTaskReminder(cardId: string, taskIndex: number, reminder: string | undefined): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col => ({
				...col,
				cards: col.cards.map(card => {
					if (card.id !== cardId) return card;
					if (taskIndex >= card.tasks.length) return card;
					const tasks = card.tasks.map((t, i) =>
						i === taskIndex ? { ...t, reminder } : t
					);
					return { ...card, tasks };
				}),
			})),
		};
		await this.writeToDisk();
	}

	async deleteCard(cardId: string): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col => ({
				...col,
				cards: col.cards.filter(c => c.id !== cardId),
			})),
		};
		await this.writeToDisk();
	}

	async archiveCard(cardId: string): Promise<void> {
		await this.updateCard(cardId, { archived: true, archivedAt: getDateStamp() });
	}

	async restoreCard(cardId: string): Promise<void> {
		await this.updateCard(cardId, { archived: false, archivedAt: '' });
	}

	async addCard(columnName: string, overrides?: Partial<DashboardCard>): Promise<void> {
		if (!this.data) return;
		const column = this.data.columns.find(col => col.name === columnName);
		const sectionType = column?.sectionType;
		const cardTitle = overrides?.title ?? this.getDefaultCardTitle(columnName, sectionType);
		const cardType = overrides?.type ?? this.getDefaultCardType(columnName, sectionType);

		const newCard: DashboardCard = {
			id: `card-${Date.now().toString(36)}`,
			title: cardTitle,
			type: cardType,
			column: columnName,
			body: '',
			tasks: cardType === 'task' ? [{ text: t('sync.todoDefaultTask'), checked: false }] : [],
			url: '',
			wikiLink: '',
			progress: -1,
			streak: 0,
			dueDate: '',
			blockquote: '',
			color: '',
			coverImage: '',
			archived: false,
			archivedAt: '',
				width: 0,
			size: 'M' as const,
			gridCols: 0,
			gridRows: 0,
			gridCol: 0,
			gridRow: 0,
			...overrides,
		};

		this.data = {
			...this.data,
			columns: this.data.columns.map(col =>
				col.name === columnName
					? { ...col, cards: [...col.cards, newCard] }
					: col
			),
		};
		await this.writeToDisk();
	}

	async addColumn(name: string, sectionType?: string): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: [...this.data.columns, { name, color: '#6366f1', sectionType, cards: [] }],
		};
		await this.writeToDisk();
	}

	async updateLibraryConfig(columnName: string, config: import('./types').LibraryConfig): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col =>
				col.name === columnName ? { ...col, libraryConfig: config } : col
			),
		};
		await this.writeToDisk();
	}


	async renameColumn(oldName: string, newName: string): Promise<void> {
		if (!this.data || !newName || oldName === newName) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col =>
				col.name === oldName ? { ...col, name: newName } : col
			),
		};
		await this.writeToDisk();
	}

	async updateBanner(updates: Partial<BannerData>): Promise<void> {
		if (!this.data) return;
		this.data = {
			...this.data,
			banner: { ...this.data.banner, ...updates },
		};
		await this.writeToDisk();
	}

	async addQuickAction(action: QuickAction): Promise<void> {
		if (!this.data) return;
		this.data = {
			...this.data,
			quickActions: [...this.data.quickActions, action],
		};
		await this.writeToDisk();
	}

	async removeQuickAction(index: number): Promise<void> {
		if (!this.data) return;
		this.data = {
			...this.data,
			quickActions: this.data.quickActions.filter((_, i) => i !== index),
		};
		await this.writeToDisk();
	}

	async reorderQuickActions(order: string[]): Promise<void> {
		if (!this.data) return;
		this.data = {
			...this.data,
			quickActionOrder: order,
		};
		await this.writeToDisk();
	}

	async removeQuickActionByKey(key: string): Promise<void> {
		if (!this.data) return;
		if (key.startsWith('p:')) {
			// Preset: add to hiddenPresets and remove from order
			const hidden = [...(this.data.hiddenPresets ?? [])];
			if (!hidden.includes(key)) hidden.push(key);
			this.data = {
				...this.data,
				hiddenPresets: hidden,
				quickActionOrder: (this.data.quickActionOrder ?? []).filter(k => k !== key),
			};
		} else {
			// Custom: remove from quickActions[] and order
			const target = key.slice(2);
			this.data = {
				...this.data,
				quickActions: this.data.quickActions.filter(a => a.target !== target),
				quickActionOrder: (this.data.quickActionOrder ?? []).filter(k => k !== key),
			};
		}
		await this.writeToDisk();
	}

	async updateMemoCard(cardId: string, updates: { body: string; blockquote: string }): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col => ({
				...col,
				cards: col.cards.map(card =>
					card.id === cardId ? { ...card, ...updates } : card
				),
			})),
		};
		await this.writeToDisk();
	}

	async reorderDocPaths(cardId: string, fromIndex: number, toIndex: number): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col => ({
				...col,
				cards: col.cards.map(card => {
					if (card.id !== cardId) return card;
					const paths = card.body.split('\n')
						.map(l => l.trim())
						.filter(l => l.startsWith('[[') && l.endsWith(']]'))
						.map(l => l.slice(2, -2));
					if (fromIndex < 0 || fromIndex >= paths.length) return card;
					if (toIndex < 0 || toIndex >= paths.length) return card;
					const moved = paths[fromIndex]!;
					paths.splice(fromIndex, 1);
					paths.splice(toIndex, 0, moved);
					const body = paths.map(p => `[[${p}]]`).join('\n');
					return { ...card, body };
				}),
			})),
		};
		await this.writeToDisk();
	}

	async moveDocToCard(srcCardId: string, docIndex: number, destCardId: string, destIndex: number): Promise<void> {
		if (!this.data) return;

		let movedDocPath: string | undefined;

		const columnsWithout = this.data.columns.map(col => ({
			...col,
			cards: col.cards.map(card => {
				if (card.id !== srcCardId) return card;
				const paths = card.body.split('\n')
					.map(l => l.trim())
					.filter(l => l.startsWith('[[') && l.endsWith(']]'))
					.map(l => l.slice(2, -2));
				if (docIndex < 0 || docIndex >= paths.length) return card;
				movedDocPath = paths[docIndex];
				const newPaths = paths.filter((_, i) => i !== docIndex);
				const body = newPaths.map(p => `[[${p}]]`).join('\n');
				return { ...card, body };
			}),
		}));

		if (!movedDocPath) return;

		this.data = {
			...this.data,
			columns: columnsWithout.map(col => ({
				...col,
				cards: col.cards.map(card => {
					if (card.id !== destCardId) return card;
					const paths = card.body.split('\n')
						.map(l => l.trim())
						.filter(l => l.startsWith('[[') && l.endsWith(']]'))
						.map(l => l.slice(2, -2));
					const clamped = Math.min(destIndex, paths.length);
					paths.splice(clamped, 0, movedDocPath!);
					const body = paths.map(p => `[[${p}]]`).join('\n');
					return { ...card, body };
				}),
			})),
		};
		await this.writeToDisk();
	}

	async updateProjectDocs(cardId: string, docPaths: string[]): Promise<void> {
		if (!this.data) return;

		const body = docPaths.map(p => `[[${p}]]`).join('\n');

		this.data = {
			...this.data,
			columns: this.data.columns.map(col => ({
				...col,
				cards: col.cards.map(card =>
					card.id === cardId ? { ...card, body } : card
				),
			})),
		};
		await this.writeToDisk();
	}

	async addDocToCard(cardId: string, filePath: string): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col => ({
				...col,
				cards: col.cards.map(card => {
					if (card.id !== cardId) return card;
					const paths = card.body.split('\n')
						.map(l => l.trim())
						.filter(l => l.startsWith('[[') && l.endsWith(']]'))
						.map(l => l.slice(2, -2));
					if (paths.includes(filePath)) return card;
					paths.push(filePath);
					const body = paths.map(p => `[[${p}]]`).join('\n');
					return { ...card, body };
				}),
			})),
		};
		await this.writeToDisk();
	}

	async addFileLinkToMemo(cardId: string, filePath: string): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col => ({
				...col,
				cards: col.cards.map(card => {
					if (card.id !== cardId) return card;
					const link = `[[${filePath}]]`;
					if (card.body.includes(link)) return card;
					const body = card.body ? `${card.body}\n${link}` : link;
					return { ...card, body };
				}),
			})),
		};
		await this.writeToDisk();
	}

	async updateMemoColor(cardId: string, color: string): Promise<void> {
		await this.updateCard(cardId, { color });
	}

	async updateCardWidth(cardId: string, width: number): Promise<void> {
		await this.updateCard(cardId, { width });
	}

	async updateCardSize(cardId: string, size: import('./types').CardSize): Promise<void> {
		await this.updateCard(cardId, { size });
	}

	async updateCardGrid(cardId: string, gridCols: number, gridRows: number): Promise<void> {
		await this.updateCard(cardId, { gridCols, gridRows });
	}

	async updateCardGridMove(cardId: string, gridCol: number, gridRow: number): Promise<void> {
		await this.updateCard(cardId, { gridCol, gridRow });
	}

	async updateProjectCover(cardId: string, coverImage: string): Promise<void> {
		await this.updateCard(cardId, { coverImage });
	}

	async replaceData(newData: DashboardData): Promise<void> {
		this.data = newData;
		await this.writeToDisk();
	}

	async addHeatmapItem(columnName: string, item: import('./types').HeatmapItem): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col =>
				col.name === columnName
					? { ...col, heatmapItems: [...(col.heatmapItems ?? []), item] }
					: col
			),
		};
		await this.writeToDisk();
	}

	async updateHeatmapItem(columnName: string, itemId: string, updates: Partial<import('./types').HeatmapItem>): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col =>
				col.name === columnName
					? {
						...col,
						heatmapItems: (col.heatmapItems ?? []).map(item =>
							item.id === itemId ? { ...item, ...updates } : item
						),
					}
					: col
			),
		};
		await this.writeToDisk();
	}

	async deleteHeatmapItem(columnName: string, itemId: string): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col =>
				col.name === columnName
					? { ...col, heatmapItems: (col.heatmapItems ?? []).filter(item => item.id !== itemId) }
					: col
			),
		};
		await this.writeToDisk();
	}

	async toggleHeatmapLayout(columnName: string): Promise<void> {
		if (!this.data) return;

		this.data = {
			...this.data,
			columns: this.data.columns.map(col =>
				col.name === columnName
					? { ...col, heatmapLayout: col.heatmapLayout === 'row' ? 'column' : 'row' }
					: col
			),
		};
		await this.writeToDisk();
	}


	private getDefaultCardTitle(columnName: string, sectionType?: string): string {
		const effective = sectionType?.toLowerCase();
		if (effective === 'memo' || (!effective && columnName.toLowerCase() === 'memo')) {
			const now = new Date();
			const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
			return t('sync.memoTitle', { date });
		}
		if (effective === 'todo' || (!effective && columnName.toLowerCase() === 'todo')) return t('sync.todoTitle');
		if (effective === 'notes') return t('sync.notesTitle');
		if (columnName.toLowerCase() === 'projects') return t('sync.projectTitle');
		return t('sync.newCard');
	}

	private getDefaultCardType(columnName: string, sectionType?: string): CardType {
		const effective = sectionType?.toLowerCase();
		if (effective === 'todo' || (!effective && columnName.toLowerCase() === 'todo')) return 'task';
		if (effective === 'memo' || (!effective && columnName.toLowerCase() === 'memo')) return 'generic';
		if (effective === 'dashboard' || (!effective && columnName.toLowerCase() === 'dashboard')) return 'weather';
		return 'project';
	}

	private async findOrCreateFile(): Promise<void> {
		const rawPath = this.settings.dashboardFile.trim();
		const path = rawPath.endsWith('.md') ? rawPath : `${rawPath}.md`;
		const existing = this.app.vault.getFileByPath(path);
		if (existing) {
			this.file = existing;
			return;
		}

		const content = generateDefaultMarkdown();
		this.file = await this.app.vault.create(path, content);
	}

	private deferredWriteTimer: ReturnType<typeof setTimeout> | null = null;
	private renameEventRef: ReturnType<typeof this.app.vault.on> | null = null;

	private registerFileWatcher(): void {
		const filePath = this.file?.path;
		this.eventRef = this.app.vault.on('modify', (file) => {
			if (file instanceof TFile && file.path === filePath) {
				this.onFileModify();
			}
		});

		this.renameEventRef = this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
			if (!this.data) return;
			if (!(file instanceof TFile)) return;
			this.handleFileRename(file, oldPath);
		});
	}

	private handleFileRename(file: TFile, oldPath: string): void {
		if (!this.data) return;
		const newPath = file.path;
		let changed = false;

		const replace = (str: string): string => {
			if (!str || !str.includes(oldPath)) return str;
			changed = true;
			return str.split(oldPath).join(newPath);
		};

		const oldPathNoExt = oldPath.endsWith('.md') ? oldPath.slice(0, -3) : oldPath;
		const newName = file.basename;

		const quickActions = this.data.quickActions.map(action => {
			if (action.type !== 'file') return action;
			if (action.target !== oldPath && action.target !== oldPathNoExt) return action;
			changed = true;
			return { ...action, target: newPath, name: newName };
		});

		const banner = { ...this.data.banner, image: replace(this.data.banner.image) };

		const columns = this.data.columns.map(col => ({
			...col,
			cards: col.cards.map(card => ({
				...card,
				coverImage: replace(card.coverImage),
			})),
		}));

		if (!changed) return;

		// Cancel pending re-parse to prevent race condition
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}

		this.data = { ...this.data, banner, quickActions, columns };
		this.writeToDisk();
	}

	private scheduleDeferredWrite(): void {
		if (this.deferredWriteTimer) clearTimeout(this.deferredWriteTimer);
		this.deferredWriteTimer = setTimeout(() => {
			this.deferredWriteTimer = null;
			if (this.data) {
				this.writeToDisk();
			}
		}, 1000);
	}

	private onFileModify(): void {
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => {
			this.load();
		}, this.debounceMs);
	}

	private async load(): Promise<void> {
		if (!this.file) return;

		const content = await this.app.vault.read(this.file);
		const hash = simpleHash(content);
		if (hash === this.lastWrittenHash) return;

		this.data = parse(content);
		this.notifyCallbacks();
	}

	private async writeToDisk(): Promise<void> {
		if (!this.data || !this.file) return;

		const content = serialize(this.data);
		const hash = simpleHash(content);

		const fileRef = this.file;
		this.writeQueue = this.writeQueue.then(async () => {
			try {
				const current = await this.app.vault.read(fileRef);

				// Safety: skip write if new content is drastically smaller
				if (current.length > 0 && content.length < current.length * 0.3) {
					console.warn('Dashboard write skipped: new content significantly smaller than current file');
					return;
				}

				// Backup current file before overwriting
				await this.createBackup(current);

				await this.app.vault.modify(fileRef, content);
				this.lastWrittenHash = hash;
			} catch (err) {
				console.error('Dashboard sync write failed:', err);
			}
		});

		this.notifyCallbacks();
	}

	private async createBackup(currentContent: string): Promise<void> {
		try {
			const adapter = this.app.vault.adapter;
			const dir = SyncEngine.BACKUP_DIR;
			if (!(await adapter.exists(dir))) {
				await adapter.mkdir(dir);
			}

			const ts = new Date().toISOString().replace(/[:.]/g, '-');
			const backupPath = dir + '/dashboard-' + ts + '.md';
			await adapter.write(backupPath, currentContent);

			// Prune old backups, keep only MAX_BACKUPS
			const files = await adapter.list(dir);
			const backups = files.files
				.filter((f: string) => f.startsWith(dir + '/dashboard-') && f.endsWith('.md'))
				.sort();
			while (backups.length > SyncEngine.MAX_BACKUPS) {
				await adapter.remove(backups.shift()!);
			}
		} catch {
			// Backup failure should never block the main write
		}
	}

	private notifyCallbacks(): void {
		if (!this.data) return;
		for (const cb of this.callbacks) {
			cb(this.data);
		}
	}
}

function simpleHash(str: string): string {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		hash = ((hash << 5) - hash) + ch;
		hash |= 0;
	}
	return hash.toString(36);
}

function getDateStamp(): string {
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, '0');
	const d = String(now.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}
