import { useState } from 'react';
import { BookOpen, LayoutDashboard, Calendar, SquareCheck as CheckSquare, StickyNote, Phone, ChartBar as FileBarChart2, MessageCircle, Video, CircleUser as UserCircle, Hash, Bot, Search, ChevronRight, ChevronLeft, Share2, Archive, Send, UserPlus, CalendarPlus, CreditCard as Edit2, Trash2, Paperclip, Smile, Mic, Image as ImageIcon, Star, Bell, BellOff, Tag, Clock, Users, Lock, Settings, Plus, RefreshCw, Download, Upload, ExternalLink, Eye, CircleCheck as CheckCircle2, Circle as XCircle, CircleAlert as AlertCircle, ListFilter as Filter, SlidersHorizontal, LogOut, Sun, Moon, Volume2, VolumeX, PhoneCall, Zap, Brain, Sparkles, Layers, Globe, Building2, ChartBar as BarChart2, ChartPie as PieChart, TrendingUp, Table, CalendarDays, Hop as Home, X, List, Forward, Reply, Pin, Activity, Newspaper, Palette, LayoutGrid, User } from 'lucide-react';

interface TutorialPageProps {
  onAskSpark?: (command: string) => void;
}

interface IconItem {
  icon: React.ElementType;
  name: string;
  desc: string;
  color?: string;
}

interface GuideSection {
  id: string;
  title: string;
  icon: React.ElementType;
  color: string;
  gradient: string;
  overview: string;
  icons: IconItem[];
  steps: { title: string; items: string[] }[];
  tips: string[];
  sparkQuestions: string[];
}

const SECTIONS: GuideSection[] = [
  {
    id: 'meetings',
    title: 'درخواست جلسه',
    icon: LayoutDashboard,
    color: 'blue',
    gradient: 'from-blue-500 to-blue-700',
    overview: 'مرکز مدیریت تمام جلسات سازمانی — درخواست، ثبت، تایید و پیگیری جلسات با تمام شرکت‌کنندگان.',
    icons: [
      { icon: UserPlus, name: 'ارسال به کاربر', desc: 'جلسه را به کاربر دیگری ارسال کنید تا شرکت‌کننده انتخاب کند', color: 'text-blue-600' },
      { icon: Share2, name: 'اشتراک‌گذاری', desc: 'تصویر جلسه را به واتساپ، بله ارسال یا دانلود کنید', color: 'text-green-600' },
      { icon: Send, name: 'ارسال به مدیر', desc: 'جلسات در وضعیت درخواست‌شده را برای تایید ارسال کنید', color: 'text-sky-600' },
      { icon: Edit2, name: 'ویرایش', desc: 'اطلاعات جلسه را ویرایش کنید (موضوع، زمان، مکان و ...)', color: 'text-amber-600' },
      { icon: CalendarPlus, name: 'برنامه‌ریزی در تقویم', desc: 'جلسه تایید‌شده را به تقویم داخلی اضافه کنید', color: 'text-teal-600' },
      { icon: Archive, name: 'بایگانی', desc: 'جلسه‌های تکمیل‌شده را ببندید و بایگانی کنید', color: 'text-slate-600' },
      { icon: ExternalLink, name: 'افزودن به گوگل', desc: 'جلسه تایید‌شده را به گوگل کلندر منتقل کنید', color: 'text-red-600' },
      { icon: CheckSquare, name: 'اقدامات جلسه', desc: 'وظایف پیگیری جلسه را مشاهده یا اضافه کنید', color: 'text-emerald-600' },
      { icon: Bell, name: 'اعلان', desc: 'اعلان پیامک یا درون‌برنامه‌ای برای شرکت‌کنندگان', color: 'text-orange-600' },
      { icon: Filter, name: 'فیلتر', desc: 'فیلتر جلسات بر اساس وضعیت، اولویت یا تاریخ', color: 'text-purple-600' },
    ],
    steps: [
      {
        title: 'ایجاد جلسه جدید',
        items: [
          'روی دکمه «جلسه جدید» کلیک کنید',
          'موضوع، تاریخ، مدت، محل، نماینده و شماره تماس را وارد کنید',
          'اولویت را مشخص کنید: بالا / متوسط / پایین',
          'شرکت‌کنندگان را از لیست کاربران انتخاب کنید',
          'ایمیل مهمانان خارجی را در صورت نیاز وارد کنید',
          'روی «ایجاد جلسه» کلیک کنید',
        ],
      },
      {
        title: 'وضعیت‌های جلسه',
        items: [
          'درخواست شده: جلسه ثبت شده و منتظر تایید ادمین',
          'تایید شده: جلسه تایید و قابل برنامه‌ریزی در تقویم',
          'رد شده: جلسه توسط ادمین رد شده',
          'لغو شده: جلسه توسط کاربر یا اسپارک لغو شده',
          'بایگانی شده: جلسه تکمیل شده و بسته',
        ],
      },
      {
        title: 'اقدامات (وظایف) جلسه',
        items: [
          'در پایین کارت جلسه روی «اقدامات» کلیک کنید',
          'عنوان اقدام و مسئول را مشخص کنید',
          'اقدام به کارتابل مسئول ارسال می‌شود',
          'وضعیت: در انتظار / در حال انجام / تکمیل شده',
        ],
      },
    ],
    tips: [
      'برای جستجوی سریع جلسه، نام موضوع را در نوار جستجوی بالا تایپ کنید',
      'جلسات با اولویت «بالا» با رنگ قرمز مشخص می‌شوند',
      'می‌توانید جلسات را به‌صورت عکس به واتساپ یا بله ارسال کنید',
      'اسپارک می‌تواند جلسه را لغو یا زمانش را جابجا کند',
    ],
    sparkQuestions: [
      'چطور یک جلسه جدید ثبت کنم؟',
      'وضعیت جلسات امروز چیه؟',
      'جلسه تست را لغو کن',
      'جلسه هماهنگی را یک ساعت جلو بنداز',
    ],
  },
  {
    id: 'calendar',
    title: 'تقویم',
    icon: Calendar,
    color: 'teal',
    gradient: 'from-teal-500 to-teal-700',
    overview: 'تقویم شمسی هوشمند با نمای روزانه، هفتگی و ماهانه — مدیریت جلسات، مناسبت‌ها و زمان‌بندی با اشتراک‌گذاری بین کاربران.',
    icons: [
      { icon: ChevronLeft, name: 'قبلی', desc: 'رفتن به روز / هفته / ماه قبل', color: 'text-teal-600' },
      { icon: ChevronRight, name: 'بعدی', desc: 'رفتن به روز / هفته / ماه بعد', color: 'text-teal-600' },
      { icon: Home, name: 'امروز', desc: 'بازگشت سریع به روز جاری', color: 'text-blue-600' },
      { icon: Plus, name: 'رویداد جدید', desc: 'ایجاد رویداد یا جلسه جدید در تقویم', color: 'text-green-600' },
      { icon: CalendarDays, name: 'نمای ماه', desc: 'نمایش ماهانه تمام رویدادها', color: 'text-teal-600' },
      { icon: List, name: 'نمای لیست', desc: 'نمایش لیستی رویدادها به‌ترتیب زمان', color: 'text-slate-600' },
      { icon: Layers, name: 'تقویم چندگانه', desc: 'مشاهده و مدیریت تقویم‌های مختلف', color: 'text-purple-600' },
      { icon: Eye, name: 'اشتراک', desc: 'مشترک شدن در تقویم سایر کاربران', color: 'text-amber-600' },
      { icon: Globe, name: 'تقویم عمومی', desc: 'تقویم اشتراکی سازمان — مناسبت‌های تعطیلات', color: 'text-sky-600' },
      { icon: Star, name: 'مناسبت‌ها', desc: 'تقویم مناسبت‌های ملی و مذهبی', color: 'text-yellow-600' },
    ],
    steps: [
      {
        title: 'نمای‌های تقویم',
        items: [
          'نمای روز: جزئیات رویدادهای امروز با ساعت دقیق',
          'نمای هفته: مشاهده ۷ روز همزمان',
          'نمای ماه: جدول کلی ماهانه',
          'لیست هفتگی/ماهانه: فهرست رویدادها به ترتیب زمان',
        ],
      },
      {
        title: 'تقویم‌های چندگانه',
        items: [
          'تقویم «شخصی» هنگام ثبت‌نام به‌طور خودکار ایجاد می‌شود',
          'برای تقویم جدید: سایدبار → «تقویم جدید»',
          'رنگ هر تقویم قابل تنظیم است',
          'می‌توانید در تقویم‌های سایر کاربران مشترک شوید',
          'تقویم «مناسبت‌ها» رویدادهای ملی را نمایش می‌دهد',
        ],
      },
    ],
    tips: [
      'برای ایجاد رویداد سریع، روی هر خانه خالی در تقویم کلیک کنید',
      'جلسات تایید‌شده با آیکن تقویم به تقویم اضافه می‌شوند',
      'اسپارک می‌تواند به تاریخ خاصی در تقویم ببرد',
    ],
    sparkQuestions: [
      'تقویم ماهانه را باز کن',
      'جلسات فردا چیه؟',
      'برو به تاریخ ۱ مهر',
      'نمای هفتگی نشون بده',
    ],
  },
  {
    id: 'chat',
    title: 'چت سازمانی',
    icon: MessageCircle,
    color: 'green',
    gradient: 'from-green-500 to-emerald-700',
    overview: 'سیستم پیام‌رسانی داخلی سازمان با پشتیبانی از پیام‌های متنی، فایل، تصویر، تماس صوتی و تصویری.',
    icons: [
      { icon: Send, name: 'ارسال پیام', desc: 'ارسال متن پیام با Enter یا دکمه ارسال', color: 'text-green-600' },
      { icon: Paperclip, name: 'پیوست فایل', desc: 'ارسال فایل، تصویر، اسناد', color: 'text-blue-600' },
      { icon: Smile, name: 'ایموجی', desc: 'افزودن شکلک به پیام', color: 'text-yellow-600' },
      { icon: Mic, name: 'پیام صوتی', desc: 'ضبط و ارسال پیام صوتی', color: 'text-red-600' },
      { icon: Reply, name: 'پاسخ', desc: 'پاسخ به پیام خاص (رفرنس)', color: 'text-sky-600' },
      { icon: Forward, name: 'فوروارد', desc: 'ارسال پیام به مخاطب دیگر', color: 'text-teal-600' },
      { icon: Pin, name: 'پین کردن', desc: 'پین پیام مهم برای دسترسی سریع', color: 'text-amber-600' },
      { icon: Tag, name: 'برچسب', desc: 'افزودن تگ به پیام برای دسته‌بندی', color: 'text-purple-600' },
      { icon: Bell, name: 'یادآور', desc: 'تنظیم یادآور برای پیام مهم', color: 'text-orange-600' },
      { icon: AlertCircle, name: 'اورژانسی', desc: 'علامت‌گذاری پیام به عنوان فوری یا مهم', color: 'text-red-600' },
      { icon: PhoneCall, name: 'تماس صوتی', desc: 'شروع تماس صوتی مستقیم', color: 'text-green-600' },
      { icon: Video, name: 'تماس تصویری', desc: 'شروع ویدیو کال با کاربر', color: 'text-blue-600' },
      { icon: Trash2, name: 'حذف پیام', desc: 'حذف پیام (فقط برای خودتان یا برای همه)', color: 'text-red-500' },
    ],
    steps: [
      {
        title: 'شروع مکالمه',
        items: [
          'سایدبار چپ → گفتگوی جدید (آیکن +)',
          'نام کاربر مورد نظر را جستجو کنید',
          'روی نام کلیک کنید — مکالمه باز می‌شود',
          'تایپ کنید و Enter بزنید یا روی آیکن ارسال کلیک کنید',
        ],
      },
      {
        title: 'مدیریت پیام‌ها',
        items: [
          'هولد / راست‌کلیک روی پیام: منوی عملیات باز می‌شود',
          'ریکشن با ایموجی: کلیک روی 🙂 در منوی پیام',
          'وضعیت: ✓ ارسال شده، ✓✓ تحویل داده شده، ✓✓ (آبی) خوانده شده',
          'فایل‌ها و تصاویر در پنل اطلاعات مکالمه موجودند',
        ],
      },
    ],
    tips: [
      'پیام‌های اورژانسی با رنگ قرمز و پیام‌های مهم با رنگ نارنجی نمایش داده می‌شوند',
      'اسپارک می‌تواند برای شما پیام ارسال کند',
      'گفتگوهای حذف‌شده فقط برای شما پاک می‌شوند',
    ],
    sparkQuestions: [
      'پیام بده به زهرا با موضوع پیگیری پروژه',
      'تماس صوتی با علی بگیر',
      'برو به صفحه چت',
    ],
  },
  {
    id: 'channels',
    title: 'کانال‌ها',
    icon: Hash,
    color: 'purple',
    gradient: 'from-violet-500 to-purple-700',
    overview: 'کانال‌های سازمانی — فضاهای تیمی برای همکاری گروهی، اشتراک‌گذاری محتوا و مدیریت کارهای تیمی.',
    icons: [
      { icon: Hash, name: 'کانال', desc: 'هر کانال یک فضای تیمی با موضوع مشخص', color: 'text-purple-600' },
      { icon: Lock, name: 'کانال خصوصی', desc: 'کانال با دسترسی محدود — فقط اعضای دعوت‌شده', color: 'text-red-600' },
      { icon: Globe, name: 'کانال عمومی', desc: 'کانال باز — همه کاربران می‌توانند عضو شوند', color: 'text-green-600' },
      { icon: Users, name: 'اعضا', desc: 'مدیریت اعضای کانال — دعوت یا حذف', color: 'text-blue-600' },
      { icon: Settings, name: 'تنظیمات', desc: 'تغییر نام، آیکن و رنگ کانال', color: 'text-slate-600' },
      { icon: Pin, name: 'پیام پین‌شده', desc: 'پیام‌های مهم که در بالای کانال نمایش داده می‌شوند', color: 'text-amber-600' },
      { icon: CheckSquare, name: 'کارهای تیمی', desc: 'مدیریت وظایف گروهی در کانال', color: 'text-emerald-600' },
      { icon: Star, name: 'ستاره', desc: 'کانال‌های مورد علاقه را ستاره‌دار کنید', color: 'text-yellow-600' },
      { icon: BellOff, name: 'بی‌صدا', desc: 'غیرفعال کردن اعلان‌های کانال', color: 'text-gray-600' },
      { icon: Newspaper, name: 'موضوعات کاری', desc: 'پنل اخبار و موضوعات مرتبط با کانال', color: 'text-sky-600' },
    ],
    steps: [
      {
        title: 'ایجاد کانال',
        items: [
          'سایدبار → «کانال جدید»',
          'نام، توضیح و نوع کانال (عمومی/خصوصی) را انتخاب کنید',
          'اعضای اولیه را دعوت کنید',
          'رنگ و آیکن کانال را تنظیم کنید',
        ],
      },
      {
        title: 'کارهای تیمی در کانال',
        items: [
          'پنل «کارهای تیمی» در سایدبار کانال',
          'ایجاد کار، تعیین مسئول و ددلاین',
          'وضعیت کارها: در انتظار / در حال انجام / تکمیل',
          'اعضا می‌توانند کارها را به خود اختصاص دهند',
        ],
      },
    ],
    tips: [
      'از # برای اشاره به کانال‌ها در پیام‌ها استفاده کنید',
      'کانال‌های ستاره‌دار در بالای لیست نمایش می‌یابند',
      'مدیر کانال می‌تواند پیام‌ها را ویرایش یا حذف کند',
    ],
    sparkQuestions: [
      'برو به صفحه کانال‌ها',
      'چطور یک کانال جدید بسازم؟',
    ],
  },
  {
    id: 'tasks',
    title: 'اقدامات (کارتابل)',
    icon: CheckSquare,
    color: 'orange',
    gradient: 'from-orange-500 to-amber-600',
    overview: 'کارتابل شخصی — مدیریت وظایف محول‌شده، ایجاد اقدام جدید و پیگیری وضعیت انجام کارها.',
    icons: [
      { icon: Plus, name: 'وظیفه جدید', desc: 'ایجاد اقدام/وظیفه جدید', color: 'text-orange-600' },
      { icon: Edit2, name: 'ویرایش', desc: 'تغییر عنوان، توضیح یا سررسید وظیفه', color: 'text-amber-600' },
      { icon: Trash2, name: 'حذف', desc: 'حذف وظیفه از لیست', color: 'text-red-600' },
      { icon: CheckCircle2, name: 'تکمیل', desc: 'علامت‌گذاری وظیفه به عنوان انجام‌شده', color: 'text-green-600' },
      { icon: Archive, name: 'بایگانی', desc: 'بایگانی وظایف تکمیل‌شده', color: 'text-slate-600' },
      { icon: AlertCircle, name: 'اولویت بالا', desc: 'وظایف فوری یا بحرانی', color: 'text-red-600' },
      { icon: Clock, name: 'سررسید', desc: 'تاریخ و زمان انجام وظیفه', color: 'text-blue-600' },
      { icon: User, name: 'مسئول', desc: 'شخص مسئول انجام وظیفه', color: 'text-teal-600' },
      { icon: Filter, name: 'فیلتر', desc: 'فیلتر وظایف بر اساس وضعیت یا اولویت', color: 'text-purple-600' },
    ],
    steps: [
      {
        title: 'تب‌های کارتابل',
        items: [
          'ارجاع به من: وظایفی که دیگران به شما واگذار کرده‌اند',
          'ایجاد‌شده توسط من: وظایفی که خودتان ثبت کرده‌اید',
          'همه: مشاهده کلیه وظایف',
          'بایگانی: وظایف تکمیل و بسته‌شده',
        ],
      },
      {
        title: 'ایجاد وظیفه',
        items: [
          'روی «اقدام جدید» کلیک کنید',
          'عنوان، توضیح، اولویت و تاریخ سررسید را وارد کنید',
          'مسئول را از لیست کاربران انتخاب کنید',
          'اقدام در کارتابل مسئول نمایش داده می‌شود',
        ],
      },
    ],
    tips: [
      'وظایف دیر‌کرده با رنگ قرمز مشخص می‌شوند',
      'اسپارک می‌تواند وظیفه جدید ایجاد کند',
      'وظایف ارجاع‌شده با برچسب آبی «ارجاع به من» مشخص هستند',
    ],
    sparkQuestions: [
      'چند تا اقدام دارم؟',
      'اقدام ایجاد کن با عنوان بررسی گزارش برای علی',
      'برو به صفحه اقدامات',
    ],
  },
  {
    id: 'notes',
    title: 'یادداشت‌ها',
    icon: StickyNote,
    color: 'yellow',
    gradient: 'from-yellow-500 to-amber-500',
    overview: 'یادداشت‌های سریع با پشتیبانی از متن، پیوست فایل، تبدیل صدا به متن و اشتراک‌گذاری.',
    icons: [
      { icon: Plus, name: 'یادداشت جدید', desc: 'ایجاد یادداشت جدید', color: 'text-yellow-600' },
      { icon: Edit2, name: 'ویرایش', desc: 'تغییر عنوان یا محتوای یادداشت', color: 'text-amber-600' },
      { icon: Trash2, name: 'حذف', desc: 'حذف یادداشت از لیست', color: 'text-red-600' },
      { icon: Archive, name: 'بایگانی', desc: 'بایگانی یادداشت‌های قدیمی', color: 'text-slate-600' },
      { icon: Mic, name: 'دیکته', desc: 'تبدیل صدا به متن در یادداشت', color: 'text-blue-600' },
      { icon: Paperclip, name: 'پیوست', desc: 'افزودن فایل یا تصویر به یادداشت', color: 'text-teal-600' },
      { icon: Share2, name: 'اشتراک‌گذاری', desc: 'ارسال یادداشت به واتساپ یا بله', color: 'text-green-600' },
      { icon: Download, name: 'دانلود', desc: 'دانلود یادداشت به عنوان تصویر', color: 'text-purple-600' },
    ],
    steps: [
      {
        title: 'ایجاد یادداشت',
        items: [
          'روی «یادداشت جدید» کلیک کنید',
          'عنوان و محتوای یادداشت را وارد کنید',
          'از آیکن میکروفون برای تبدیل صدا به متن استفاده کنید',
          'فایل یا تصویر پیوست کنید',
          'روی «ذخیره» کلیک کنید',
        ],
      },
    ],
    tips: [
      'یادداشت‌ها می‌توانند به عنوان تصویر دانلود یا در شبکه‌های اجتماعی به اشتراک گذاشته شوند',
      'اسپارک می‌تواند یادداشت جدید ثبت کند',
    ],
    sparkQuestions: [
      'یادداشت ثبت کن با عنوان جلسه فردا',
      'چند تا یادداشت دارم؟',
      'برو به صفحه یادداشت‌ها',
    ],
  },
  {
    id: 'contacts',
    title: 'مخاطبین',
    icon: Phone,
    color: 'cyan',
    gradient: 'from-cyan-500 to-sky-600',
    overview: 'دفترچه تلفن و مخاطبین سازمانی — ذخیره اطلاعات تماس، سازمان و ایمیل به‌همراه جستجوی سریع.',
    icons: [
      { icon: Plus, name: 'مخاطب جدید', desc: 'افزودن مخاطب تلفنی یا ایمیل جدید', color: 'text-cyan-600' },
      { icon: Edit2, name: 'ویرایش', desc: 'تغییر اطلاعات مخاطب', color: 'text-amber-600' },
      { icon: Trash2, name: 'حذف', desc: 'حذف مخاطب از دفترچه', color: 'text-red-600' },
      { icon: Search, name: 'جستجو', desc: 'جستجو بر اساس نام، شماره یا موضوع', color: 'text-blue-600' },
      { icon: Download, name: 'خروجی Excel', desc: 'صادر کردن لیست مخاطبین به فایل Excel', color: 'text-green-600' },
      { icon: Upload, name: 'ورودی Excel', desc: 'وارد کردن مخاطبین از فایل Excel', color: 'text-orange-600' },
      { icon: Building2, name: 'سازمان', desc: 'نام شرکت یا سازمان مخاطب', color: 'text-slate-600' },
    ],
    steps: [
      {
        title: 'ثبت مخاطب',
        items: [
          'روی «مخاطب جدید» کلیک کنید',
          'نام، شماره تماس و سازمان را وارد کنید',
          'برای مخاطبین ایمیل، آدرس ایمیل را هم وارد کنید',
          'اطلاعات با هنگام ایجاد جلسه به‌صورت خودکار ذخیره می‌شوند',
        ],
      },
    ],
    tips: [
      'مخاطبین قابل صادر کردن به Excel هستند',
      'اسپارک می‌تواند مخاطب جدید ثبت کند',
    ],
    sparkQuestions: [
      'چند تا مخاطب دارم؟',
      'مخاطب اضافه کن به نام احمدی شماره ۰۹۱۲۱۲۳۴۵۶۷',
      'برو به صفحه مخاطبین',
    ],
  },
  {
    id: 'reports',
    title: 'گزارشات',
    icon: FileBarChart2,
    color: 'rose',
    gradient: 'from-rose-500 to-red-600',
    overview: 'داشبورد تحلیلی — نمودارهای آماری جلسات، اقدامات و فعالیت‌های سازمانی با قابلیت خروجی Excel.',
    icons: [
      { icon: BarChart2, name: 'نمودار ستونی', desc: 'نمودار روند جلسات در ماه‌های گذشته', color: 'text-rose-600' },
      { icon: PieChart, name: 'نمودار دایره‌ای', desc: 'توزیع اولویت‌ها و وضعیت‌ها', color: 'text-purple-600' },
      { icon: TrendingUp, name: 'روند', desc: 'تحلیل روند رشد یا کاهش جلسات', color: 'text-green-600' },
      { icon: Table, name: 'جدول داده', desc: 'آخرین جلسات و اقدامات در قالب جدول', color: 'text-blue-600' },
      { icon: Filter, name: 'فیلتر زمانی', desc: 'فیلتر: ماه جاری، ۳ ماه، ۶ ماه، سال', color: 'text-teal-600' },
      { icon: Download, name: 'خروجی Excel', desc: 'صادر کردن گزارش به فایل xlsx', color: 'text-emerald-600' },
      { icon: RefreshCw, name: 'بارگذاری مجدد', desc: 'به‌روزرسانی داده‌های گزارش', color: 'text-slate-600' },
    ],
    steps: [
      {
        title: 'داشبورد گزارش',
        items: [
          'KPIها: تعداد کل جلسات، اقدامات و نرخ تکمیل',
          'نمودار ماهانه: روند جلسات ۶ ماه گذشته',
          'توزیع اولویت: درصد جلسات بالا، متوسط، پایین',
          'جدول آخرین جلسات برای بررسی سریع',
          'انتخاب بازه زمانی دلخواه',
        ],
      },
    ],
    tips: [
      'گزارش را به فرمت Excel دانلود کنید برای ارائه به مدیریت',
      'فیلتر سال جاری کامل‌ترین دیدگاه را می‌دهد',
    ],
    sparkQuestions: [
      'برو به صفحه گزارشات',
      'چند تا جلسه این ماه داشتم؟',
      'چند تا جلسه تا حالا گذاشتم؟',
    ],
  },
  {
    id: 'video',
    title: 'ویدیو کنفرانس',
    icon: Video,
    color: 'indigo',
    gradient: 'from-sky-500 to-blue-700',
    overview: 'سیستم ویدیو کنفرانس داخلی — ایجاد اتاق جلسه، دعوت شرکت‌کنندگان و کنترل دوربین/میکروفون.',
    icons: [
      { icon: Plus, name: 'اتاق جدید', desc: 'ایجاد اتاق ویدیو کنفرانس جدید', color: 'text-blue-600' },
      { icon: Video, name: 'ورود به اتاق', desc: 'پیوستن به اتاق ویدیو کنفرانس', color: 'text-green-600' },
      { icon: Mic, name: 'میکروفون', desc: 'روشن/خاموش کردن میکروفون', color: 'text-red-600' },
      { icon: ImageIcon, name: 'دوربین', desc: 'روشن/خاموش کردن دوربین', color: 'text-blue-600' },
      { icon: UserPlus, name: 'دعوت', desc: 'ارسال دعوت‌نامه به سایر کاربران', color: 'text-teal-600' },
      { icon: ExternalLink, name: 'لینک مهمان', desc: 'لینک اتاق برای مهمانان بدون حساب کاربری', color: 'text-purple-600' },
      { icon: LogOut, name: 'خروج', desc: 'خروج از اتاق بدون بستن جلسه', color: 'text-amber-600' },
      { icon: XCircle, name: 'پایان جلسه', desc: 'بستن اتاق برای همه شرکت‌کنندگان', color: 'text-red-600' },
      { icon: SlidersHorizontal, name: 'اندازه تایل', desc: 'تنظیم اندازه نمایش تصاویر شرکت‌کنندگان', color: 'text-slate-600' },
    ],
    steps: [
      {
        title: 'برگزاری جلسه',
        items: [
          'روی «اتاق جدید» کلیک و نام اتاق را وارد کنید',
          'لینک مهمان را برای کسانی که حساب ندارند کپی کنید',
          'اعضای سازمان را با آیکن دعوت فراخوانید',
          'دوربین و میکروفون را قبل از ورود چک کنید',
          'هنگام پایان، «پایان جلسه» را فشار دهید تا همه خارج شوند',
        ],
      },
    ],
    tips: [
      'میزبان می‌تواند بدون پایان دادن جلسه از اتاق خارج شود',
      'لینک مهمان نیاز به ثبت‌نام ندارد',
      'جلسات تقویم می‌توانند اتاق کنفرانس مرتبط داشته باشند',
    ],
    sparkQuestions: [
      'برو به صفحه ویدیو کنفرانس',
      'تماس تصویری با علی بگیر',
    ],
  },
  {
    id: 'spark',
    title: 'اسپارک (هوش مصنوعی)',
    icon: Bot,
    color: 'sky',
    gradient: 'from-sky-500 to-blue-600',
    overview: 'دستیار هوشمند فارسی‌زبان — با دستور زبان طبیعی می‌توانید تمام عملیات سیستم را انجام دهید.',
    icons: [
      { icon: Zap, name: 'AI فعال', desc: 'هوش مصنوعی Groq/OpenAI متصل است', color: 'text-yellow-500' },
      { icon: Sparkles, name: 'اسپارک پایه', desc: 'پردازش محلی بدون نیاز به کلید API', color: 'text-sky-500' },
      { icon: Brain, name: 'حافظه', desc: 'اسپارک مخاطبین و ترجیحات شما را به خاطر می‌سپارد', color: 'text-purple-600' },
      { icon: Mic, name: 'دستور صوتی', desc: 'دستور را با صدا بگویید — پردازش می‌شود', color: 'text-red-600' },
      { icon: Volume2, name: 'پاسخ صوتی', desc: 'اسپارک می‌تواند پاسخ را بخواند', color: 'text-teal-600' },
      { icon: RefreshCw, name: 'بارگذاری مجدد', desc: 'رفرش تنظیمات اسپارک', color: 'text-slate-600' },
      { icon: VolumeX, name: 'بی‌صدا', desc: 'خاموش کردن پاسخ صوتی اسپارک', color: 'text-gray-500' },
    ],
    steps: [
      {
        title: 'دستورات قابل اجرا',
        items: [
          'لغو جلسه: «جلسه [موضوع] را لغو کن»',
          'جابجایی زمان: «جلسه [موضوع] را یک ساعت جلو بنداز»',
          'ارسال پیام: «پیام بده به [نام] با موضوع [متن]»',
          'ایجاد اقدام: «اقدام ایجاد کن با عنوان [عنوان] برای [نام]»',
          'ایجاد یادداشت: «یادداشت ثبت کن با عنوان [عنوان]»',
          'افزودن مخاطب: «مخاطب اضافه کن به نام [نام] شماره [شماره]»',
          'پرس‌وجو: «چند تا جلسه امروز دارم؟»',
          'ناوبری: «برو به تقویم» یا «صفحه چت را باز کن»',
          'هر سوال عمومی: اسپارک جواب می‌دهد',
        ],
      },
      {
        title: 'تنظیمات اسپارک (ادمین)',
        items: [
          'پنل ادمین → تنظیمات اسپارک',
          'کلید API را از Groq یا OpenAI وارد کنید',
          'مدل هوش مصنوعی مورد نظر را انتخاب کنید',
          'کلیدواژه‌های سازمانی را تنظیم کنید',
        ],
      },
    ],
    tips: [
      'هر دستور فارسی قابل قبول است — کامل یا خلاصه',
      'اسپارک بعد از تشخیص، بلافاصله اجرا می‌کند',
      'اگر اطلاعات کافی نباشد، اسپارک سوال می‌پرسد',
      'دستورات صوتی با دکمه میکروفون فعال می‌شوند',
    ],
    sparkQuestions: [
      'چه کارهایی می‌تونی انجام بدی؟',
      'جلسات امروز را لیست کن',
      'نمای ماهانه تقویم را نشان بده',
    ],
  },
  {
    id: 'profile',
    title: 'پروفایل',
    icon: UserCircle,
    color: 'slate',
    gradient: 'from-slate-500 to-gray-600',
    overview: 'اطلاعات شخصی، سازمانی و شبکه‌های اجتماعی خود را مدیریت کنید.',
    icons: [
      { icon: ImageIcon, name: 'تصویر پروفایل', desc: 'کلیک روی دوربین برای تغییر عکس (JPG/PNG/WEBP)', color: 'text-blue-600' },
      { icon: User, name: 'اطلاعات شخصی', desc: 'نام، موبایل، کد ملی، تاریخ تولد، جنسیت', color: 'text-teal-600' },
      { icon: Building2, name: 'اطلاعات سازمانی', desc: 'سازمان، سمت، واحد، کد پرسنلی', color: 'text-slate-600' },
      { icon: Globe, name: 'شبکه اجتماعی', desc: 'وب‌سایت و لینکدین', color: 'text-sky-600' },
      { icon: Activity, name: 'وضعیت حضور', desc: 'آنلاین / مشغول / دور از دستگاه / مزاحم نشوید', color: 'text-green-600' },
      { icon: Sun, name: 'حالت روز', desc: 'تم روشن (Light Mode)', color: 'text-amber-500' },
      { icon: Moon, name: 'حالت شب', desc: 'تم تاریک (Dark Mode)', color: 'text-slate-600' },
      { icon: Palette, name: 'رنگ تم', desc: 'انتخاب رنگ اصلی رابط کاربری', color: 'text-purple-600' },
    ],
    steps: [
      {
        title: 'تکمیل پروفایل',
        items: [
          'روی آیکن کاربر در بالای صفحه → «پروفایل»',
          'اطلاعات شخصی را پر کنید',
          'تصویر پروفایل را آپلود کنید',
          'سمت و واحد سازمانی را تکمیل کنید',
          'روی «ذخیره» کلیک کنید',
        ],
      },
    ],
    tips: [
      'پروفایل کامل باعث می‌شود سایر کاربران شما را بهتر بشناسند',
      'وضعیت حضور شما در چت و لیست کاربران نمایش داده می‌شود',
      'رنگ تم و حالت تاریک در همه صفحات اعمال می‌شود',
    ],
    sparkQuestions: [
      'برو به صفحه پروفایل',
    ],
  },
];

const colorClasses: Record<string, {
  bg: string; text: string; lightBg: string; border: string; dot: string; badge: string
}> = {
  blue:   { bg: 'bg-blue-600',   text: 'text-blue-600 dark:text-blue-400',   lightBg: 'bg-blue-50 dark:bg-blue-900/20',   border: 'border-blue-200 dark:border-blue-800',   dot: 'bg-blue-500',   badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' },
  teal:   { bg: 'bg-teal-600',   text: 'text-teal-600 dark:text-teal-400',   lightBg: 'bg-teal-50 dark:bg-teal-900/20',   border: 'border-teal-200 dark:border-teal-800',   dot: 'bg-teal-500',   badge: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300' },
  green:  { bg: 'bg-green-600',  text: 'text-green-600 dark:text-green-400', lightBg: 'bg-green-50 dark:bg-green-900/20', border: 'border-green-200 dark:border-green-800', dot: 'bg-green-500', badge: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300' },
  purple: { bg: 'bg-purple-600', text: 'text-purple-600 dark:text-purple-400', lightBg: 'bg-purple-50 dark:bg-purple-900/20', border: 'border-purple-200 dark:border-purple-800', dot: 'bg-purple-500', badge: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300' },
  orange: { bg: 'bg-orange-600', text: 'text-orange-600 dark:text-orange-400', lightBg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-200 dark:border-orange-800', dot: 'bg-orange-500', badge: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300' },
  yellow: { bg: 'bg-yellow-500', text: 'text-yellow-600 dark:text-yellow-400', lightBg: 'bg-yellow-50 dark:bg-yellow-900/20', border: 'border-yellow-200 dark:border-yellow-800', dot: 'bg-yellow-500', badge: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-300' },
  cyan:   { bg: 'bg-cyan-600',   text: 'text-cyan-600 dark:text-cyan-400',   lightBg: 'bg-cyan-50 dark:bg-cyan-900/20',   border: 'border-cyan-200 dark:border-cyan-800',   dot: 'bg-cyan-500',   badge: 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300' },
  rose:   { bg: 'bg-rose-600',   text: 'text-rose-600 dark:text-rose-400',   lightBg: 'bg-rose-50 dark:bg-rose-900/20',   border: 'border-rose-200 dark:border-rose-800',   dot: 'bg-rose-500',   badge: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300' },
  indigo: { bg: 'bg-sky-600',    text: 'text-sky-600 dark:text-sky-400',     lightBg: 'bg-sky-50 dark:bg-sky-900/20',     border: 'border-sky-200 dark:border-sky-800',     dot: 'bg-sky-500',    badge: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300' },
  sky:    { bg: 'bg-sky-600',    text: 'text-sky-600 dark:text-sky-400',     lightBg: 'bg-sky-50 dark:bg-sky-900/20',     border: 'border-sky-200 dark:border-sky-800',     dot: 'bg-sky-500',    badge: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300' },
  slate:  { bg: 'bg-slate-600',  text: 'text-slate-600 dark:text-slate-400', lightBg: 'bg-slate-50 dark:bg-slate-900/20', border: 'border-slate-200 dark:border-slate-700', dot: 'bg-slate-500', badge: 'bg-slate-100 dark:bg-slate-900/40 text-slate-700 dark:text-slate-300' },
  red:    { bg: 'bg-red-600',    text: 'text-red-600 dark:text-red-400',     lightBg: 'bg-red-50 dark:bg-red-900/20',     border: 'border-red-200 dark:border-red-800',     dot: 'bg-red-500',    badge: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300' },
};

export function TutorialPage({ onAskSpark }: TutorialPageProps) {
  const [activeId, setActiveId] = useState<string>('meetings');
  const [searchQuery, setSearchQuery] = useState('');

  const activeSection = SECTIONS.find(s => s.id === activeId) || SECTIONS[0];

  const filtered = searchQuery.trim()
    ? SECTIONS.filter(s =>
        s.title.includes(searchQuery) ||
        s.overview.includes(searchQuery) ||
        s.icons.some(i => i.name.includes(searchQuery) || i.desc.includes(searchQuery)) ||
        s.steps.some(st => st.title.includes(searchQuery) || st.items.some(it => it.includes(searchQuery)))
      )
    : SECTIONS;

  return (
    <div className="flex flex-col h-full" dir="rtl">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-white dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700 px-6 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-teal-400 to-sky-500 flex items-center justify-center shadow-md">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-white leading-tight">راهنمای جامع سامانه</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">آموزش آیکن به آیکن تمام بخش‌ها</p>
            </div>
          </div>
          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="جستجو در راهنما..."
              className="w-full pr-9 pl-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute left-2 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar ────────────────────────────────────────────────── */}
        <div className="w-52 flex-shrink-0 bg-gray-50 dark:bg-gray-900 border-l border-gray-100 dark:border-gray-700 overflow-y-auto">
          <div className="p-2 space-y-0.5">
            {(searchQuery ? filtered : SECTIONS).map(section => {
              const Icon = section.icon;
              const sc = colorClasses[section.color] || colorClasses.blue;
              const isActive = activeId === section.id && !searchQuery;
              return (
                <button
                  key={section.id}
                  onClick={() => { setActiveId(section.id); setSearchQuery(''); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-right transition-all ${
                    isActive
                      ? `${sc.lightBg} ${sc.text} font-semibold`
                      : 'text-gray-600 dark:text-gray-400 hover:bg-white dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
                  }`}
                >
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${isActive ? sc.lightBg : 'bg-white dark:bg-gray-800'}`}>
                    <Icon className={`w-4 h-4 ${isActive ? sc.text : 'text-gray-400 dark:text-gray-500'}`} />
                  </div>
                  <span className="text-sm truncate">{section.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Main content ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {searchQuery && filtered.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <Search className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>نتیجه‌ای یافت نشد</p>
            </div>
          )}

          {/* Show all search results OR single active section */}
          {(searchQuery ? filtered : [activeSection]).map(section => {
            const SectionIcon = section.icon;
            const sc = colorClasses[section.color] || colorClasses.blue;
            return (
              <div key={section.id}>
                {/* Section Header */}
                <div className={`rounded-2xl p-5 mb-5 bg-gradient-to-r ${section.gradient} text-white shadow-md`}>
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
                      <SectionIcon className="w-6 h-6 text-white" />
                    </div>
                    <h2 className="text-xl font-bold">{section.title}</h2>
                  </div>
                  <p className="text-sm text-white/85 leading-relaxed">{section.overview}</p>
                </div>

                {/* Icons Guide */}
                <div className={`bg-white dark:bg-gray-800 rounded-2xl border ${sc.border} overflow-hidden mb-5`}>
                  <div className={`px-4 py-3 ${sc.lightBg} border-b ${sc.border} flex items-center gap-2`}>
                    <LayoutGrid className={`w-4 h-4 ${sc.text}`} />
                    <h3 className={`text-sm font-bold ${sc.text}`}>راهنمای آیکن‌ها</h3>
                  </div>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-gray-100 dark:bg-gray-700">
                    {section.icons.map((item, i) => {
                      const ItemIcon = item.icon;
                      return (
                        <div key={i} className="flex items-start gap-3 p-3.5 bg-white dark:bg-gray-800">
                          <div className={`w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center ${sc.lightBg}`}>
                            <ItemIcon className={`w-4.5 h-4.5 ${item.color || sc.text}`} />
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-gray-800 dark:text-white leading-tight mb-0.5">{item.name}</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">{item.desc}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Steps */}
                <div className="grid md:grid-cols-2 gap-4 mb-5">
                  {section.steps.map((step, si) => (
                    <div key={si} className={`bg-white dark:bg-gray-800 rounded-2xl border ${sc.border} overflow-hidden`}>
                      <div className={`px-4 py-3 ${sc.lightBg} border-b ${sc.border}`}>
                        <h3 className={`text-sm font-bold ${sc.text}`}>{step.title}</h3>
                      </div>
                      <ul className="p-4 space-y-2.5">
                        {step.items.map((item, ii) => (
                          <li key={ii} className="flex items-start gap-2.5">
                            <span className={`mt-1.5 w-5 h-5 rounded-full text-[10px] font-bold flex-shrink-0 flex items-center justify-center text-white ${sc.bg}`}>{ii + 1}</span>
                            <span className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                {/* Tips */}
                {section.tips.length > 0 && (
                  <div className={`bg-white dark:bg-gray-800 rounded-2xl border ${sc.border} p-4 mb-5`}>
                    <div className="flex items-center gap-2 mb-3">
                      <Sparkles className={`w-4 h-4 ${sc.text}`} />
                      <h3 className={`text-sm font-bold ${sc.text}`}>نکات کلیدی</h3>
                    </div>
                    <ul className="space-y-2">
                      {section.tips.map((tip, ti) => (
                        <li key={ti} className="flex items-start gap-2.5">
                          <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${sc.dot}`} />
                          <span className="text-sm text-gray-700 dark:text-gray-300">{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Ask Spark */}
                {onAskSpark && section.sparkQuestions.length > 0 && (
                  <div className="bg-gradient-to-r from-sky-50 to-blue-50 dark:from-sky-900/20 dark:to-blue-900/20 rounded-2xl border border-sky-200 dark:border-sky-800 p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center">
                        <Bot className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-sky-800 dark:text-sky-300">بپرس از اسپارک</h3>
                        <p className="text-[11px] text-sky-600 dark:text-sky-400">روی هر سوال کلیک کنید تا اسپارک جواب دهد</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {section.sparkQuestions.map((q, qi) => (
                        <button
                          key={qi}
                          onClick={() => onAskSpark(q)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-gray-800 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-700 rounded-full text-xs font-medium hover:bg-sky-50 dark:hover:bg-sky-900/30 hover:border-sky-400 transition-all shadow-sm"
                        >
                          <Zap className="w-3 h-3" />
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
