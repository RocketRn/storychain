import { createContext, useContext } from "react";
import type { ErrorCode } from "@storychain/shared/light";

export type Lang = "ru" | "en";

const ru = {
  appName: "StoryChain",
  loading: "Загрузка…",
  retry: "Повторить",
  back: "Назад",
  close: "Закрыть",
  errorTitle: "Что-то пошло не так",
  loadMore: "Показать ещё",
  // home
  homeHello: "Привет, {name}!",
  homeSubtitle: "Присоединяйся к цепочкам или запусти свою",
  createChain: "Создать цепочку",
  featured: "Избранное",
  trending: "В тренде",
  homeEmpty: "Пока нет цепочек. Создай первую!",
  // chain
  join: "Присоединиться",
  joinedShare: "Вы в цепочке — поделиться ещё раз",
  by: "Автор: {name}",
  galleryEmpty: "Пока никого. Будь первым!",
  chainNotFoundTitle: "Цепочка не найдена",
  chainNotFoundText: "Возможно, она удалена или ссылка неверна.",
  browseChains: "Смотреть цепочки",
  you: "Вы",
  // create
  createTitle: "Новая цепочка",
  fieldTitle: "Тема",
  placeholderTitle: "Покажи своего кота",
  fieldEmoji: "Эмодзи",
  fieldDescription: "Описание (необязательно)",
  create: "Создать",
  creating: "Создаём…",
  titleHint: "От 3 до 80 символов",
  ideas: "Идеи",
  idea1: "Покажи своего кота",
  idea2: "Твой стол прямо сейчас",
  idea3: "Трек дня",
  payStars: "Оплатить Stars · {amount} ⭐",
  payGrm: "Оплатить {amount}",
  payWithGrm: "💎 Оплатить в GRM",
  connectWallet: "Подключить кошелёк",
  payProcessing: "Платёж обрабатывается…",
  paySlow:
    "Платёж ещё обрабатывается — на блокчейне это может занять пару минут. Можно закрыть экран — продвижение включится автоматически.",
  checkAgain: "Проверить ещё раз",
  payCancelled: "Оплата отменена",
  payFailed: "Не удалось оплатить. Попробуй ещё раз.",
  payExpired: "Время платежа истекло. Начни заново.",
  noGrm: "В этом кошельке нет GRM",
  walletRejected: "Транзакция отклонена в кошельке",
  grmUnavailableHere: "Оплата GRM недоступна на этой платформе — используй Stars.",
  profileTitle: "Профиль",
  profileAria: "Открыть профиль",
  myPosts: "Мои публикации",
  noPostsYet: "Ты пока не участвовал ни в одной цепочке",
  // editor
  shareJoin: "Присоединяйся",
  widgetName: "Присоединиться к цепочке",
  shareAgain: "Поделиться ещё раз",
  sendToChat: "Отправить в чат",
  updateCard: "Обновить мою карточку",
  shareFallback:
    "Эта версия Telegram не умеет публиковать истории из приложения. Ссылка скопирована, картинка открыта — добавь их в историю вручную.",
  stickerYourTurn: "Твой черед",
  editorTitle: "Новая карточка",
  stepPhoto: "Фото",
  stepStyle: "Стиль",
  stepPublish: "Публикация",
  pickPhoto: "Выбрать фото",
  takePhoto: "Сделать снимок",
  pickPhotoHint: "Выбери фото из галереи или сними новое",
  photoError: "Не удалось открыть это изображение",
  next: "Далее",
  changePhoto: "Другое фото",
  templates: "Шаблоны",
  fonts: "Шрифты",
  zoom: "Масштаб",
  dragHint: "Двигай и масштабируй фото пальцами",
  captionLabel: "Подпись (необязательно)",
  captionPlaceholder: "Добавь пару слов…",
  publish: "Опубликовать в Stories",
  publishing: "Публикуем…",
  doneTitle: "Готово!",
  doneText: "Ты #{n} в цепочке «{title}»",
  openChain: "Открыть цепочку",
  back2: "Назад",
  // participants (plural forms)
  participants_one: "{n} участник",
  participants_few: "{n} участника",
  participants_many: "{n} участников",
  participants_other: "{n} участника",
  // errors by code
  // boosts
  sponsored: "Реклама",
  hotTitle: "Горячие марафоны",
  openChannel: "Открыть канал",
  boostMarathon: "Продвинуть марафон",
  boostedUntilExtend: "Продвигается до {date} · Продлить",
  boostModalTitle: "Продвижение марафона",
  boostModalIntro: "Марафон «{title}» попадёт в карусель «Горячие марафоны» на главной.",
  boostPickPlan: "Срок продвижения",
  plan24h: "24 часа",
  plan7d: "7 дней",
  channelLabel: "Ссылка на ваш Telegram-канал (необязательно)",
  channelHint: "Показывается только пока марафон продвигается",
  channelInvalid: "Нужна ссылка t.me или @username канала",
  channelPlaceholder: "https://t.me/mychannel",
  boostSuccess: "Ваш марафон теперь в карусели «Горячие» до {date}",
  boostDone: "Готово",
  boostChip: "Продвигается",
  boostAction: "Продвинуть",
  myMarathons: "Мои марафоны",
  noMarathons: "Вы ещё не создавали марафонов",
  badgeNote: "На каждую карточку добавляется небольшая метка StoryChain.",
  payTitle: "Способ оплаты",
  err_CHAIN_NOT_FOUND: "Марафон не найден",
  err_CHAIN_NOT_BOOSTABLE: "Этот марафон нельзя продвигать",
  err_INVALID_BOOST_PLAN: "Неизвестный срок продвижения",
  err_BOOST_HORIZON_EXCEEDED: "Марафон уже продвигается слишком далеко вперёд",
  err_INVALID_CHANNEL_URL: "Нужна ссылка t.me или @username канала",
  err_BAD_REQUEST: "Проверьте введённые данные",
  err_UNAUTHORIZED: "Сессия недействительна. Откройте приложение заново",
  err_FORBIDDEN: "Недостаточно прав",
  err_NOT_FOUND: "Не найдено",
  err_RATE_LIMITED: "Слишком много запросов, попробуйте позже",
  err_INVALID_IMAGE: "Некорректное изображение",
  err_PAYLOAD_TOO_LARGE: "Файл слишком большой",
  err_BLOCKED_CONTENT: "Такой текст нельзя использовать",
  err_PAYMENT_NOT_FOUND: "Платёж не найден",
  err_PAYMENT_METHOD_UNAVAILABLE: "Способ оплаты недоступен",
  err_INTERNAL: "Ошибка сервера",
  err_NETWORK: "Нет соединения с сервером",
};

export type Dict = typeof ru;
export type DictKey = keyof Dict;

const en: Dict = {
  appName: "StoryChain",
  loading: "Loading…",
  retry: "Retry",
  back: "Back",
  close: "Close",
  errorTitle: "Something went wrong",
  loadMore: "Load more",
  homeHello: "Hi, {name}!",
  homeSubtitle: "Join a chain or start your own",
  createChain: "Create chain",
  featured: "Featured",
  trending: "Trending",
  homeEmpty: "No chains yet. Create the first one!",
  join: "Join",
  joinedShare: "You joined — share again",
  by: "By {name}",
  galleryEmpty: "Nobody yet. Be the first!",
  chainNotFoundTitle: "Chain not found",
  chainNotFoundText: "It may have been removed, or the link is wrong.",
  browseChains: "Browse chains",
  you: "You",
  createTitle: "New chain",
  fieldTitle: "Topic",
  placeholderTitle: "Show your cat",
  fieldEmoji: "Emoji",
  fieldDescription: "Description (optional)",
  create: "Create",
  creating: "Creating…",
  titleHint: "3 to 80 characters",
  ideas: "Ideas",
  idea1: "Show your cat",
  idea2: "Your desk right now",
  idea3: "Track of the day",
  payStars: "Pay with Stars · {amount} ⭐",
  payGrm: "Pay {amount}",
  payWithGrm: "💎 Pay with GRM",
  connectWallet: "Connect wallet",
  payProcessing: "Processing payment…",
  paySlow:
    "Still processing — on-chain payments can take a couple of minutes. You can leave this screen, the boost will switch on automatically.",
  checkAgain: "Check again",
  payCancelled: "Payment cancelled",
  payFailed: "Payment failed. Please try again.",
  payExpired: "The payment window expired. Start again.",
  noGrm: "This wallet holds no GRM",
  walletRejected: "Transaction was rejected in the wallet",
  grmUnavailableHere: "GRM payments are not available on this platform — use Stars.",
  profileTitle: "Profile",
  profileAria: "Open profile",
  myPosts: "My posts",
  noPostsYet: "You haven't joined any chain yet",
  shareJoin: "Join",
  widgetName: "Join the chain",
  shareAgain: "Share again",
  sendToChat: "Send to chat",
  updateCard: "Update my card",
  shareFallback:
    "This Telegram version can't publish stories from the app. The link is copied and the image is opened — add them to your story manually.",
  stickerYourTurn: "Your turn",
  editorTitle: "New card",
  stepPhoto: "Photo",
  stepStyle: "Style",
  stepPublish: "Publish",
  pickPhoto: "Choose photo",
  takePhoto: "Take a photo",
  pickPhotoHint: "Pick a photo from your gallery or take a new one",
  photoError: "Could not open this image",
  next: "Next",
  changePhoto: "Change photo",
  templates: "Templates",
  fonts: "Fonts",
  zoom: "Zoom",
  dragHint: "Drag and pinch to frame your photo",
  captionLabel: "Caption (optional)",
  captionPlaceholder: "Add a few words…",
  publish: "Publish to Story",
  publishing: "Publishing…",
  doneTitle: "Done!",
  doneText: "You are #{n} in “{title}”",
  openChain: "Open chain",
  back2: "Back",
  participants_one: "{n} participant",
  participants_few: "{n} participants",
  participants_many: "{n} participants",
  participants_other: "{n} participants",
  // boosts
  sponsored: "Sponsored",
  hotTitle: "Hot Marathons",
  openChannel: "Open channel",
  boostMarathon: "Boost marathon",
  boostedUntilExtend: "Boosted until {date} · Extend",
  boostModalTitle: "Boost your marathon",
  boostModalIntro: "“{title}” will be pinned to the Hot Marathons carousel on Home.",
  boostPickPlan: "Boost length",
  plan24h: "24 hours",
  plan7d: "7 days",
  channelLabel: "Your Telegram channel link (optional)",
  channelHint: "Shown only while the marathon is boosted",
  channelInvalid: "Use a t.me link or the @username of a channel",
  channelPlaceholder: "https://t.me/mychannel",
  boostSuccess: "Your marathon is now in the Hot carousel until {date}",
  boostDone: "Done",
  boostChip: "Boosted",
  boostAction: "Boost",
  myMarathons: "My marathons",
  noMarathons: "You haven't created any marathon yet",
  badgeNote: "A small StoryChain badge is added to every card.",
  payTitle: "Payment method",
  err_CHAIN_NOT_FOUND: "Marathon not found",
  err_CHAIN_NOT_BOOSTABLE: "This marathon cannot be boosted",
  err_INVALID_BOOST_PLAN: "Unknown boost length",
  err_BOOST_HORIZON_EXCEEDED: "This marathon is already boosted far enough ahead",
  err_INVALID_CHANNEL_URL: "Use a t.me link or the @username of a channel",
  err_BAD_REQUEST: "Please check the entered data",
  err_UNAUTHORIZED: "Session is invalid. Please reopen the app",
  err_FORBIDDEN: "Not allowed",
  err_NOT_FOUND: "Not found",
  err_RATE_LIMITED: "Too many requests, try again later",
  err_INVALID_IMAGE: "Invalid image",
  err_PAYLOAD_TOO_LARGE: "File is too large",
  err_BLOCKED_CONTENT: "This text is not allowed",
  err_PAYMENT_NOT_FOUND: "Payment not found",
  err_PAYMENT_METHOD_UNAVAILABLE: "Payment method unavailable",
  err_INTERNAL: "Server error",
  err_NETWORK: "Cannot reach the server",
};

export const dictionaries: Record<Lang, Dict> = { ru, en };

/** ru by default; en when Telegram reports an English language code. */
export function detectLang(languageCode: string | undefined | null): Lang {
  return languageCode?.toLowerCase().startsWith("en") ? "en" : "ru";
}

export type Vars = Record<string, string | number>;

export function translate(lang: Lang, key: DictKey, vars?: Vars): string {
  let s: string = dictionaries[lang][key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Plural-aware: picks `<base>_<category>` using Intl.PluralRules (ru: one/few/many, en: one/other). */
export function translatePlural(lang: Lang, base: "participants", n: number): string {
  const cat = new Intl.PluralRules(lang).select(n);
  const key = `${base}_${cat}` as DictKey;
  return translate(lang, key in dictionaries[lang] ? key : (`${base}_other` as DictKey), { n });
}

export function errorMessage(lang: Lang, code: ErrorCode | "NETWORK"): string {
  return translate(lang, `err_${code}` as DictKey);
}

export interface I18n {
  lang: Lang;
  t: (key: DictKey, vars?: Vars) => string;
  plural: (base: "participants", n: number) => string;
  err: (code: ErrorCode | "NETWORK") => string;
}

export function makeI18n(lang: Lang): I18n {
  return {
    lang,
    t: (k, v) => translate(lang, k, v),
    plural: (b, n) => translatePlural(lang, b, n),
    err: (c) => errorMessage(lang, c),
  };
}

export const I18nContext = createContext<I18n>(makeI18n("ru"));
export const useI18n = (): I18n => useContext(I18nContext);
