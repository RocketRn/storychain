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
  proChip: "PRO до {date}",
  freeChip: "Free · осталось {left}",
  getPro: "Получить PRO",
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
  paywallTitle: "StoryChain PRO",
  paywallSubtitle: "Больше свободы для твоих цепочек",
  benefitUnlimited: "Без дневного лимита публикаций (в Free — {n} в день)",
  benefitNoWatermark: "Без водяного знака",
  benefitPremium: "Премиум-шаблоны и шрифты",
  planName: "PRO · 30 дней",
  proActiveUntil: "PRO активен до {date}",
  extendHint: "Оплата продлит PRO ещё на 30 дней.",
  payStars: "Оплатить Stars · {amount} ⭐",
  payGrm: "Оплатить {amount} GRM",
  payWithGrm: "💎 Оплатить в GRM",
  connectWallet: "Подключить кошелёк",
  payProcessing: "Платёж обрабатывается…",
  paySlow:
    "Платёж ещё обрабатывается — на блокчейне это может занять пару минут. Можно закрыть экран, PRO включится автоматически.",
  checkAgain: "Проверить ещё раз",
  paySuccess: "PRO активирован!",
  payCancelled: "Оплата отменена",
  payFailed: "Не удалось оплатить. Попробуй ещё раз.",
  payExpired: "Время платежа истекло. Начни заново.",
  noGrm: "В этом кошельке нет GRM",
  walletRejected: "Транзакция отклонена в кошельке",
  backHome: "На главную",
  grmUnavailableHere: "Оплата GRM недоступна на этой платформе — используй Stars.",
  profileTitle: "Профиль",
  profileAria: "Открыть профиль",
  myPosts: "Мои публикации",
  noPostsYet: "Ты пока не участвовал ни в одной цепочке",
  usedToday: "Сегодня опубликовано: {used} из {limit}",
  proUnlimited: "PRO · без лимита",
  comingSoon: "Скоро здесь появится",
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
  proBadge: "PRO",
  zoom: "Масштаб",
  dragHint: "Двигай и масштабируй фото пальцами",
  captionLabel: "Подпись (необязательно)",
  captionPlaceholder: "Добавь пару слов…",
  publish: "Опубликовать в Stories",
  publishing: "Публикуем…",
  freeWatermark: "В бесплатной версии добавляется водяной знак. PRO убирает его.",
  doneTitle: "Готово!",
  doneText: "Ты #{n} в цепочке «{title}»",
  openChain: "Открыть цепочку",
  dailyLimitTitle: "Дневной лимит исчерпан",
  dailyLimitText: "В бесплатной версии — {n} публикации в день. Попробуй завтра или получи PRO.",
  back2: "Назад",
  // participants (plural forms)
  participants_one: "{n} участник",
  participants_few: "{n} участника",
  participants_many: "{n} участников",
  participants_other: "{n} участника",
  // errors by code
  err_BAD_REQUEST: "Проверьте введённые данные",
  err_UNAUTHORIZED: "Сессия недействительна. Откройте приложение заново",
  err_FORBIDDEN: "Недостаточно прав",
  err_NOT_FOUND: "Не найдено",
  err_RATE_LIMITED: "Слишком много запросов, попробуйте позже",
  err_DAILY_LIMIT_REACHED: "Дневной лимит публикаций исчерпан",
  err_PRO_REQUIRED: "Нужен PRO",
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
  proChip: "PRO until {date}",
  freeChip: "Free · {left} left",
  getPro: "Get PRO",
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
  paywallTitle: "StoryChain PRO",
  paywallSubtitle: "More freedom for your chains",
  benefitUnlimited: "No daily publication limit (Free: {n} per day)",
  benefitNoWatermark: "No watermark",
  benefitPremium: "Premium templates and fonts",
  planName: "PRO · 30 days",
  proActiveUntil: "PRO active until {date}",
  extendHint: "Paying extends PRO by another 30 days.",
  payStars: "Pay with Stars · {amount} ⭐",
  payGrm: "Pay {amount} GRM",
  payWithGrm: "💎 Pay with GRM",
  connectWallet: "Connect wallet",
  payProcessing: "Processing payment…",
  paySlow:
    "Still processing — on-chain payments can take a couple of minutes. You can leave this screen, PRO will switch on automatically.",
  checkAgain: "Check again",
  paySuccess: "PRO activated!",
  payCancelled: "Payment cancelled",
  payFailed: "Payment failed. Please try again.",
  payExpired: "The payment window expired. Start again.",
  noGrm: "This wallet holds no GRM",
  walletRejected: "Transaction was rejected in the wallet",
  backHome: "Back to home",
  grmUnavailableHere: "GRM payments are not available on this platform — use Stars.",
  profileTitle: "Profile",
  profileAria: "Open profile",
  myPosts: "My posts",
  noPostsYet: "You haven't joined any chain yet",
  usedToday: "Published today: {used} of {limit}",
  proUnlimited: "PRO · unlimited",
  comingSoon: "Coming soon",
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
  proBadge: "PRO",
  zoom: "Zoom",
  dragHint: "Drag and pinch to frame your photo",
  captionLabel: "Caption (optional)",
  captionPlaceholder: "Add a few words…",
  publish: "Publish to Story",
  publishing: "Publishing…",
  freeWatermark: "The free plan adds a watermark. PRO removes it.",
  doneTitle: "Done!",
  doneText: "You are #{n} in “{title}”",
  openChain: "Open chain",
  dailyLimitTitle: "Daily limit reached",
  dailyLimitText: "The free plan allows {n} publications per day. Try again tomorrow or get PRO.",
  back2: "Back",
  participants_one: "{n} participant",
  participants_few: "{n} participants",
  participants_many: "{n} participants",
  participants_other: "{n} participants",
  err_BAD_REQUEST: "Please check the entered data",
  err_UNAUTHORIZED: "Session is invalid. Please reopen the app",
  err_FORBIDDEN: "Not allowed",
  err_NOT_FOUND: "Not found",
  err_RATE_LIMITED: "Too many requests, try again later",
  err_DAILY_LIMIT_REACHED: "Daily publication limit reached",
  err_PRO_REQUIRED: "PRO required",
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
