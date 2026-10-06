// The fixed stylesheet. System fonts only; logical properties so ar (RTL) and en (LTR) share it.
export const STYLES_CSS = String.raw`/* Ion ui-web: fixed stylesheet. System fonts only, logical properties so ar (RTL) and en (LTR) share it. */
.ion { display: grid; grid-template-columns: 14rem 1fr; min-height: 100vh; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif; color: #1b1f23; background: #fff; }
.ion aside { padding: 1rem; border-inline-end: 1px solid #d8dee4; background: #f6f8fa; }
.ion aside nav { display: flex; flex-direction: column; gap: .25rem; margin-block-end: 1rem; }
.ion main { padding: 1.5rem; min-inline-size: 0; }
.ion a { color: #0b57d0; }
.ion h1 { margin-block: 0 1rem; font-size: 1.5rem; }
.ion h2 { font-size: 1.1rem; margin-block: 1.5rem .5rem; }
.ion .bar { display: flex; justify-content: space-between; align-items: center; gap: 1rem; }
.ion .actions { display: flex; gap: .5rem; align-items: center; margin-block-start: 1rem; }
.ion .button, .ion button { padding: .4rem .9rem; border: 1px solid #8c959f; border-radius: .4rem; background: #fff; color: inherit; font: inherit; text-decoration: none; cursor: pointer; }
.ion button[disabled] { opacity: .5; cursor: not-allowed; }
.ion .link { border: 0; background: none; padding: 0; color: #0b57d0; text-decoration: underline; }
.ion .scroll { overflow-x: auto; }
.ion table { border-collapse: collapse; inline-size: 100%; }
.ion th, .ion td { text-align: start; padding: .5rem .75rem; border-block-end: 1px solid #d8dee4; }
.ion .search { display: flex; gap: .5rem; margin-block-end: 1rem; }
.ion .search input { flex: 1; }
.ion input, .ion select, .ion textarea { padding: .4rem .6rem; border: 1px solid #8c959f; border-radius: .4rem; font: inherit; max-inline-size: 100%; }
.ion .row { display: grid; gap: .25rem; margin-block-end: 1rem; max-inline-size: 32rem; }
.ion .range { display: flex; gap: .5rem; }
.ion .pager { display: flex; gap: 1rem; align-items: center; margin-block-start: 1rem; }
.ion dl { display: grid; grid-template-columns: max-content 1fr; gap: .5rem 1.5rem; }
.ion dt { font-weight: 600; }
.ion dd { margin: 0; }
.ion li { display: flex; flex-wrap: wrap; gap: .25rem .6rem; align-items: baseline; }
.ion .badge { margin-inline-start: .5rem; padding: .1rem .5rem; border-radius: 1rem; background: #eaeef2; font-size: .85rem; }
.ion .muted { color: #59636e; }
.ion .error { color: #b3261e; }
.ion .unread { font-weight: 600; }
@media (max-width: 40rem) { .ion { grid-template-columns: 1fr; } .ion aside { border-inline-end: 0; border-block-end: 1px solid #d8dee4; } }
`;
