import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { StatefulView } from "../stateful-view.js";

/**
 * Per-tick projection of TabBar state. The selector
 * (`selectTabBarProps`) hoists every render-time derivation
 * (`allAnswered`, `answered`, `isActive`, `submitActive`) into props so
 * `render()` is pure styling.
 */
export interface TabBarProps {
	/** One per author-defined question, in order. */
	tabs: ReadonlyArray<{ label: string; answered: boolean; active: boolean }>;
	/** Submit-tab state. `allAnswered` drives the success/dim color picker. */
	submit: { active: boolean; allAnswered: boolean };
}

export class TabBar implements StatefulView<TabBarProps> {
	private props: TabBarProps;

	constructor(private readonly theme: Theme) {
		this.props = { tabs: [], submit: { active: false, allAnswered: false } };
	}

	setProps(props: TabBarProps): void {
		this.props = props;
	}

	handleInput(_data: string): void {}

	invalidate(): void {}

	render(width: number): string[] {
		// One segment per question tab, then Submit. `raw` is measured, `styled` is drawn.
		const segs = this.props.tabs.map((tab) => {
			const raw = ` ${tab.answered ? "■" : "□"} ${tab.label} `;
			const styled = tab.active
				? this.theme.bg("selectedBg", this.theme.fg("text", raw))
				: this.theme.fg(tab.answered ? "success" : "muted", raw);
			return { raw, styled, active: tab.active };
		});
		const submitText = " ✓ Submit ";
		segs.push({
			raw: submitText,
			styled: this.props.submit.active
				? this.theme.bg("selectedBg", this.theme.fg("text", submitText))
				: this.theme.fg(this.props.submit.allAnswered ? "success" : "dim", submitText),
			active: this.props.submit.active,
		});

		// Show every tab when the row fits. Otherwise show the widest run of tabs around
		// the active one, with "…" standing in for the tabs hidden on either side.
		const last = segs.length - 1;
		const rowWidth = (lo: number, hi: number): number => {
			let w = 3 + 2 + (hi - lo); // " ← ", " →", one space between neighbors
			for (let i = lo; i <= hi; i++) w += visibleWidth(segs[i].raw);
			return w + (lo > 0 ? 2 : 0) + (hi < last ? 2 : 0);
		};
		let lo = 0;
		let hi = last;
		if (rowWidth(lo, hi) > width) {
			lo = hi = Math.max(
				0,
				segs.findIndex((s) => s.active),
			);
			for (;;) {
				if (hi < last && rowWidth(lo, hi + 1) <= width) hi++;
				else if (lo > 0 && rowWidth(lo - 1, hi) <= width) lo--;
				else break;
			}
		}

		const more = this.theme.fg("dim", "…");
		const shown = segs.slice(lo, hi + 1).map((s) => s.styled);
		if (lo > 0) shown.unshift(more);
		if (hi < last) shown.push(more);
		return [truncateToWidth(` ← ${shown.join(" ")} →`, width, ""), ""];
	}
}
