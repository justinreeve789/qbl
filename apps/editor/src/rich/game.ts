/**
 * The game's own infobox code, so the editor's preview is the box players get, drawn by the
 * same functions with the same styles, and the editor cleans HTML exactly as the game does.
 */
export { infoboxView, type BoxButton, type BoxView } from '../../../client/src/ui/infobox/view';
export { sanitizeHtml } from '../../../client/src/ui/sanitize';
import '../../../client/src/ui/infobox/infobox.css';
