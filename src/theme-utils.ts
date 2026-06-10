export function inheritDashboardThemeVars(target: HTMLElement, source?: HTMLElement | null): void {
	const dashboardRoot = source?.closest('.apex-dashboard-root') ?? document.querySelector('.apex-dashboard-root');
	if (!(dashboardRoot instanceof HTMLElement)) return;
	const styles = getComputedStyle(dashboardRoot);
	const themeVars = [
		'--db-bg',
		'--db-bg-card',
		'--db-bg-card-hover',
		'--db-bg-hover',
		'--db-bg-input',
		'--db-bg-btn',
		'--db-bg-btn-hover',
		'--db-border',
		'--db-border-card',
		'--db-border-btn',
		'--db-border-input',
		'--db-border-input-focus',
		'--db-text',
		'--db-text-muted',
		'--db-text-faint',
		'--db-text-secondary',
		'--db-text-inverse',
		'--db-text-inverse-muted',
		'--db-accent',
		'--db-accent-light',
		'--db-danger',
		'--db-radius-md',
		'--db-radius-sm',
		'--db-font',
		'--db-backdrop-blur',
		'--db-shadow-card',
		'--db-shadow-card-hover',
	];
	for (const name of themeVars) {
		const value = styles.getPropertyValue(name).trim();
		if (value) target.style.setProperty(name, value);
	}
}
