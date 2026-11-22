import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useThemeColor } from 'heroui-native/hooks';
import type { LucideIcon } from 'lucide-react-native';
import ALargeSmall from 'lucide-react-native/icons/a-large-small';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import ArrowUp from 'lucide-react-native/icons/arrow-up';
import Bold from 'lucide-react-native/icons/bold';
import BookMarked from 'lucide-react-native/icons/book-marked';
import BookOpen from 'lucide-react-native/icons/book-open';
import Bookmark from 'lucide-react-native/icons/bookmark';
import Braces from 'lucide-react-native/icons/braces';
import Calendar from 'lucide-react-native/icons/calendar';
import ChartColumn from 'lucide-react-native/icons/chart-column';
import Check from 'lucide-react-native/icons/check';
import CheckCheck from 'lucide-react-native/icons/check-check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ChevronFirst from 'lucide-react-native/icons/chevron-first';
import ChevronLast from 'lucide-react-native/icons/chevron-last';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import ChevronsLeft from 'lucide-react-native/icons/chevrons-left';
import ChevronsRight from 'lucide-react-native/icons/chevrons-right';
import Circle from 'lucide-react-native/icons/circle';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import Code from 'lucide-react-native/icons/code';
import Copy from 'lucide-react-native/icons/copy';
import Crop from 'lucide-react-native/icons/crop';
import Download from 'lucide-react-native/icons/download';
import EllipsisVertical from 'lucide-react-native/icons/ellipsis-vertical';
import GitCommitHorizontal from 'lucide-react-native/icons/git-commit-horizontal';
import Headphones from 'lucide-react-native/icons/headphones';
import Heading from 'lucide-react-native/icons/heading';
import Highlighter from 'lucide-react-native/icons/highlighter';
import Info from 'lucide-react-native/icons/info';
import Italic from 'lucide-react-native/icons/italic';
import Languages from 'lucide-react-native/icons/languages';
import Library from 'lucide-react-native/icons/library';
import Link from 'lucide-react-native/icons/link';
import List from 'lucide-react-native/icons/list';
import ListFilter from 'lucide-react-native/icons/list-filter';
import MessageSquareText from 'lucide-react-native/icons/message-square-text';
import Minus from 'lucide-react-native/icons/minus';
import Paintbrush from 'lucide-react-native/icons/paintbrush';
import Pause from 'lucide-react-native/icons/pause';
import Pencil from 'lucide-react-native/icons/pencil';
import Play from 'lucide-react-native/icons/play';
import Plus from 'lucide-react-native/icons/plus';
import Puzzle from 'lucide-react-native/icons/puzzle';
import Quote from 'lucide-react-native/icons/quote';
import RotateCcw from 'lucide-react-native/icons/rotate-ccw';
import Search from 'lucide-react-native/icons/search';
import Settings from 'lucide-react-native/icons/settings';
import Share from 'lucide-react-native/icons/share';
import Share2 from 'lucide-react-native/icons/share-2';
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal';
import Sparkles from 'lucide-react-native/icons/sparkles';
import Square from 'lucide-react-native/icons/square';
import SquarePen from 'lucide-react-native/icons/square-pen';
import Star from 'lucide-react-native/icons/star';
import Strikethrough from 'lucide-react-native/icons/strikethrough';
import Sun from 'lucide-react-native/icons/sun';
import SunDim from 'lucide-react-native/icons/sun-dim';
import TextQuote from 'lucide-react-native/icons/text-quote';
import Timer from 'lucide-react-native/icons/timer';
import Trash2 from 'lucide-react-native/icons/trash-2';
import Type from 'lucide-react-native/icons/type';
import X from 'lucide-react-native/icons/x';
import { memo } from 'react';

// Icons are imported per module: Metro does not tree-shake the package barrel.
const Icons = {
  arrowUp: ArrowUp,
  back: ArrowLeft,
  bold: Bold,
  book: BookOpen,
  bookMarked: BookMarked,
  bookmark: Bookmark,
  calendar: Calendar,
  chart: ChartColumn,
  check: Check,
  checkCircle: CircleCheck,
  chevronDown: ChevronDown,
  chevronFirst: ChevronFirst,
  chevronLast: ChevronLast,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronsLeft: ChevronsLeft,
  chevronsRight: ChevronsRight,
  circle: Circle,
  close: X,
  code: Code,
  codeBlock: Braces,
  comment: MessageSquareText,
  copy: Copy,
  crop: Crop,
  delete: Trash2,
  download: Download,
  export: Share,
  extension: Puzzle,
  filter: ListFilter,
  headphones: Headphones,
  heading: Heading,
  highlighter: Highlighter,
  info: Info,
  italic: Italic,
  library: Library,
  link: Link,
  list: List,
  minus: Minus,
  more: EllipsisVertical,
  note: SquarePen,
  paintbrush: Paintbrush,
  pause: Pause,
  pencil: Pencil,
  play: Play,
  plus: Plus,
  progress: GitCommitHorizontal,
  quote: Quote,
  quoteBlock: TextQuote,
  retry: RotateCcw,
  search: Search,
  selectAll: CheckCheck,
  settings: Settings,
  share: Share2,
  sparkles: Sparkles,
  star: Star,
  stop: Square,
  strikethrough: Strikethrough,
  sun: Sun,
  sunDim: SunDim,
  text: Type,
  textSize: ALargeSmall,
  timer: Timer,
  translate: Languages,
  tune: SlidersHorizontal,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof Icons;

/**
 * Platform symbol names (SF Symbols on iOS, Material Symbols on Android) for icons
 * supplied from outside the app, such as plugin manifests.
 */
export interface PlatformSymbol {
  readonly ios: string;
  readonly android: string;
}

export type IconSource = IconName | PlatformSymbol;

/** Stroke width shared by every outline icon. */
export const ICON_STROKE_WIDTH = 1.75;

export interface IconProps {
  readonly name: IconSource;
  readonly size?: number;
  /** Defaults to the theme foreground. */
  readonly color?: string;
  readonly strokeWidth?: number;
}

/** The app's outline icon; platform symbols render through the system symbol set. */
export const Icon = memo(function Icon({ name, size = 24, color, strokeWidth = ICON_STROKE_WIDTH }: IconProps) {
  const foreground = useThemeColor('foreground');
  const tint = color ?? foreground;

  if (typeof name === 'string') {
    const Glyph = Icons[name];
    return <Glyph size={size} color={tint} strokeWidth={strokeWidth} />;
  }

  const symbol = { ios: name.ios, android: name.android, web: name.android } as SymbolViewProps['name'];
  return <SymbolView name={symbol} size={size} tintColor={tint} />;
});
