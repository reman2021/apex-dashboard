import { App, Modal, setIcon } from 'obsidian';
import type { QuickAction } from './types';
import { PRESET_ACTIONS } from './types';
import { t } from './i18n';
import { inheritDashboardThemeVars } from './theme-utils';

function actionKey(action: QuickAction, isPreset: boolean): string {
	return isPreset ? `p:${action.target}` : `c:${action.target}`;
}

interface OrderedAction {
	action: QuickAction;
	isPreset: boolean;
	key: string;
}

function buildOrderedActions(actions: QuickAction[], order?: string[], hiddenPresets?: string[]): OrderedAction[] {
	const hidden = new Set(hiddenPresets ?? []);
	const all: OrderedAction[] = [
		...PRESET_ACTIONS.filter(a => !hidden.has(actionKey(a, true))).map((a) => ({ action: a, isPreset: true, key: actionKey(a, true) })),
		...actions.map(a => ({ action: a, isPreset: false, key: actionKey(a, false) })),
	];

	if (!order || order.length === 0) return all;

	const keySet = new Set(order);
	const ordered: OrderedAction[] = [];
	for (const k of order) {
		const found = all.find(a => a.key === k);
		if (found) ordered.push(found);
	}
	for (const a of all) {
		if (!keySet.has(a.key)) ordered.push(a);
	}
	return ordered;
}

export function renderQuickActions(
	container: HTMLElement,
	actions: QuickAction[],
	onExecute: (action: QuickAction) => void,
	_onRemove: (index: number) => void,
	onAdd: () => void,
	initialPinned?: boolean,
	onTogglePin?: () => void,
	order?: string[],
	onReorder?: (order: string[]) => void,
	onRemoveByKey?: (key: string) => void,
	hiddenPresets?: string[],
): void {
	const section = container.createDiv({ cls: 'dashboard-section dashboard-quick-actions' });

	const header = section.createDiv({ cls: 'dashboard-qa-header' });
	header.createEl('h3', { text: t('quickActions.title'), cls: 'dashboard-section-title' });

	const btnGroup = header.createDiv({ cls: 'dashboard-qa-btn-group' });

	// Pin button (left of add button)
	if (onTogglePin) {
		let pinned = initialPinned ?? false;
		const pinBtn = btnGroup.createEl('button', {
			cls: 'dashboard-qa-pin-btn',
			attr: { 'aria-label': 'Toggle pin' },
		});
		const updatePinIcon = () => {
			setIcon(pinBtn, pinned ? 'pin' : 'pin-off');
			pinBtn.toggleClass('dashboard-qa-pin-btn--active', pinned);
		};
		updatePinIcon();
		pinBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			onTogglePin();
			pinned = !pinned;
			updatePinIcon();
		});
	}

	const addBtn = btnGroup.createEl('button', {
		cls: 'dashboard-qa-add-btn',
		attr: { 'aria-label': t('quickActions.addAction') },
	});
	setIcon(addBtn, 'plus');
	addBtn.addEventListener('click', onAdd);

	const list = section.createDiv({ cls: 'dashboard-qa-list' });

	const ordered = buildOrderedActions(actions, order, hiddenPresets);

	if (ordered.length === 0) {
		section.createSpan({ text: t('quickActions.empty'), cls: 'dashboard-empty' });
		return;
	}

	// DnD state
	let draggedKey: string | null = null;

	const onDragStart = (e: DragEvent, key: string) => {
		draggedKey = key;
		const target = e.currentTarget as HTMLElement;
		target.addClass('dashboard-qa-item--dragging');
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', key);
		}
	};

	const onDragEnd = (e: Event) => {
		(e.currentTarget as HTMLElement).removeClass('dashboard-qa-item--dragging');
		list.querySelectorAll('.dashboard-qa-item--drag-over').forEach(el => el.removeClass('dashboard-qa-item--drag-over'));
		draggedKey = null;
	};

	const onDragOver = (e: DragEvent) => {
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		const item = (e.target as HTMLElement).closest('.dashboard-qa-item') as HTMLElement;
		if (item && !item.hasClass('dashboard-qa-item--dragging')) {
			list.querySelectorAll('.dashboard-qa-item--drag-over').forEach(el => el.removeClass('dashboard-qa-item--drag-over'));
			item.addClass('dashboard-qa-item--drag-over');
		}
	};

	const onDragLeave = (e: DragEvent) => {
		const item = (e.target as HTMLElement).closest('.dashboard-qa-item') as HTMLElement;
		if (item) item.removeClass('dashboard-qa-item--drag-over');
	};

	const onDrop = (e: DragEvent) => {
		e.preventDefault();
		list.querySelectorAll('.dashboard-qa-item--drag-over').forEach(el => el.removeClass('dashboard-qa-item--drag-over'));
		if (!draggedKey || !onReorder) return;

		const targetItem = (e.target as HTMLElement).closest('.dashboard-qa-item') as HTMLElement;
		if (!targetItem) return;

		const targetKey = targetItem.dataset.qaKey;
		if (!targetKey || targetKey === draggedKey) return;

		// Build new order from current DOM order with the swap
		const items = Array.from(list.querySelectorAll('.dashboard-qa-item')) as HTMLElement[];
		const currentKeys = items.map(el => el.dataset.qaKey ?? '');
		const fromIdx = currentKeys.indexOf(draggedKey);
		const toIdx = currentKeys.indexOf(targetKey);
		if (fromIdx === -1 || toIdx === -1) return;

		const newKeys = currentKeys.filter(k => k !== draggedKey);
		newKeys.splice(toIdx, 0, draggedKey);
		onReorder(newKeys);
	};

	for (const { action, isPreset, key } of ordered) {
		const item = list.createDiv({
			cls: 'dashboard-qa-item' + (isPreset ? ' dashboard-qa-item--preset' : ''),
			attr: { draggable: 'true', 'data-qa-key': key },
		});

		const iconEl = item.createSpan({ cls: 'dashboard-qa-icon' });
		setIcon(iconEl, action.icon);
		item.createSpan({ text: action.name, cls: 'dashboard-qa-name' });
		item.setAttribute('title', action.name);

		// Remove button (on all items)
		const removeHandler = onRemoveByKey ?? ((k: string) => {
			if (k.startsWith('c:')) {
				const idx = actions.findIndex(a => `c:${a.target}` === k);
				if (idx !== -1) _onRemove(idx);
			}
		});
		const removeBtn = item.createEl('button', {
			cls: 'dashboard-qa-remove',
			attr: { 'aria-label': t('common.remove', { name: action.name }) },
		});
		setIcon(removeBtn, 'x');
		removeBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			removeHandler(key);
		});

		item.addEventListener('click', () => onExecute(action));
		item.setAttribute('role', 'button');

		// DnD events
		item.addEventListener('dragstart', (e) => onDragStart(e as DragEvent, key));
		item.addEventListener('dragend', onDragEnd);
		item.addEventListener('dragover', onDragOver);
		item.addEventListener('dragleave', onDragLeave);
		item.addEventListener('drop', onDrop);
	}

}

export class AddActionModal extends Modal {
	private onSelect: (action: QuickAction) => void;
	private activeTab: 'file' | 'command' = 'file';

	constructor(app: App, onSelect: (action: QuickAction) => void) {
		super(app);
		this.onSelect = onSelect;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('dashboard-modal');
		inheritDashboardThemeVars(contentEl);
		contentEl.createEl('h2', { text: t('quickActions.addAction') });

		const tabBar = contentEl.createDiv({ cls: 'dashboard-action-tabs' });
		const fileTab = tabBar.createEl('button', {
			cls: 'dashboard-action-tab active',
			text: t('quickActions.fileTab'),
		});
		const cmdTab = tabBar.createEl('button', {
			cls: 'dashboard-action-tab',
			text: t('quickActions.commandTab'),
		});

		const searchWrap = contentEl.createDiv({ cls: 'dashboard-docsearch' });

		const switchTab = (tab: 'file' | 'command') => {
			this.activeTab = tab;
			fileTab.toggleClass('active', tab === 'file');
			cmdTab.toggleClass('active', tab === 'command');
			input.value = '';
			renderResults('');
		};

		fileTab.addEventListener('click', () => switchTab('file'));
		cmdTab.addEventListener('click', () => switchTab('command'));

		const input = searchWrap.createEl('input', {
			cls: 'dashboard-modal-input dashboard-docsearch-input',
			attr: { type: 'text', placeholder: t('quickActions.searchPlaceholder'), autofocus: 'true' },
		});

		const resultsList = searchWrap.createDiv({ cls: 'dashboard-docsearch-results' });

		const renderResults = (query: string) => {
			resultsList.empty();
			const q = query.toLowerCase().trim();
			if (this.activeTab === 'file') {
				this.renderFileResults(resultsList, q);
			} else {
				this.renderCommandResults(resultsList, q);
			}
		};

		input.addEventListener('input', () => renderResults(input.value));
		renderResults('');

		const cancelBtn = contentEl.createEl('button', {
			cls: 'dashboard-docsearch-cancel',
			text: t('common.cancel'),
		});
		cancelBtn.addEventListener('click', () => this.close());
	}

	private renderFileResults(container: HTMLElement, q: string): void {
		if (!q) {
			container.createDiv({ cls: 'dashboard-docsearch-hint', text: t('quickActions.typeToSearchFile') });
			return;
		}

		const files = this.app.vault.getFiles()
			.filter(f => !f.path.startsWith('.'))
			.filter(f => f.extension === 'md' || f.extension === 'pdf' || f.extension === 'canvas' || f.extension === 'base' || /\.(png|jpg|jpeg|gif|svg|webp|bmp|mp3|mp4|m4a|m4b|mov|mkv|avi)$/i.test(f.path))
			.filter(f => f.path.toLowerCase().includes(q) || f.basename.toLowerCase().includes(q))
			.slice(0, 20);

		if (files.length === 0) {
			container.createDiv({ cls: 'dashboard-docsearch-hint', text: t('quickActions.noResults') });
			return;
		}

		for (const file of files) {
			const item = container.createDiv({ cls: 'dashboard-docsearch-item' });
			item.createEl('span', { cls: 'dashboard-docsearch-icon', text: '\u{1F4C4}' });
			const info = item.createDiv({ cls: 'dashboard-docsearch-info' });
			info.createEl('div', { cls: 'dashboard-docsearch-name', text: file.basename });
			info.createEl('div', { cls: 'dashboard-docsearch-path', text: file.path });

			item.addEventListener('click', () => {
				this.onSelect({ name: file.basename, icon: 'file-text', type: 'file', target: file.path });
				this.close();
			});
		}
	}

	private renderCommandResults(container: HTMLElement, q: string): void {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const commands = (this.app as any).commands.commands as Record<string, { name?: string }>;

		if (!commands) {
			container.createDiv({ cls: 'dashboard-docsearch-hint', text: t('quickActions.noResults') });
			return;
		}

		const entries = Object.entries(commands)
			.map(([id, cmd]) => ({ id, name: cmd.name ?? id }))
			.filter(entry => {
				if (!q) return true;
				return entry.name.toLowerCase().includes(q) || entry.id.toLowerCase().includes(q);
			})
			.sort((a, b) => a.name.localeCompare(b.name))
			.slice(0, 30);

		if (!q) {
			container.createDiv({ cls: 'dashboard-docsearch-hint', text: t('quickActions.typeToSearchCmd') });
			return;
		}

		if (entries.length === 0) {
			container.createDiv({ cls: 'dashboard-docsearch-hint', text: t('quickActions.noResults') });
			return;
		}

		for (const entry of entries) {
			const item = container.createDiv({ cls: 'dashboard-docsearch-item' });
			item.createEl('span', { cls: 'dashboard-docsearch-icon', text: '⚙️' });
			const info = item.createDiv({ cls: 'dashboard-docsearch-info' });
			info.createEl('div', { cls: 'dashboard-docsearch-name', text: entry.name });
			info.createEl('div', { cls: 'dashboard-docsearch-path', text: entry.id });

			item.addEventListener('click', () => {
				this.onSelect({ name: entry.name, icon: 'terminal', type: 'command', target: entry.id });
				this.close();
			});
		}
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}

// Kept for project search modal reuse
export class DocSearchModal extends Modal {
	private onSelect: (link: { name: string; path: string }) => void;

	constructor(app: App, onSelect: (link: { name: string; path: string }) => void) {
		super(app);
		this.onSelect = onSelect;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass('dashboard-modal');
		inheritDashboardThemeVars(contentEl);
		contentEl.createEl('h2', { text: t('quickActions.fileTab') });

		const searchWrap = contentEl.createDiv({ cls: 'dashboard-docsearch' });
		const input = searchWrap.createEl('input', {
			cls: 'dashboard-modal-input dashboard-docsearch-input',
			attr: { type: 'text', placeholder: t('quickActions.searchPlaceholder'), autofocus: 'true' },
		});
		const resultsList = searchWrap.createDiv({ cls: 'dashboard-docsearch-results' });

		const renderResults = (query: string) => {
			resultsList.empty();
			const q = query.toLowerCase().trim();
			if (!q) return;

			const files = this.app.vault.getFiles()
				.filter(f => !f.path.startsWith('.'))
				.filter(f => f.extension === 'md' || f.extension === 'pdf' || f.extension === 'canvas' || f.extension === 'base' || /\.(png|jpg|jpeg|gif|svg|webp|bmp|mp3|mp4|m4a|m4b|mov|mkv|avi)$/i.test(f.path))
				.filter(f => f.path.toLowerCase().includes(q) || f.basename.toLowerCase().includes(q))
				.slice(0, 20);

			for (const file of files) {
				const item = resultsList.createDiv({ cls: 'dashboard-docsearch-item' });
				item.createEl('span', { cls: 'dashboard-docsearch-icon', text: '\u{1F4C4}' });
				const info = item.createDiv({ cls: 'dashboard-docsearch-info' });
				info.createEl('div', { cls: 'dashboard-docsearch-name', text: file.basename });
				info.createEl('div', { cls: 'dashboard-docsearch-path', text: file.path });
				item.addEventListener('click', () => {
					this.onSelect({ name: file.basename, path: file.path });
					this.close();
				});
			}
		};

		input.addEventListener('input', () => renderResults(input.value));
		input.focus();

		contentEl.createEl('button', {
			cls: 'dashboard-docsearch-cancel',
			text: t('common.cancel'),
		}).addEventListener('click', () => this.close());
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
