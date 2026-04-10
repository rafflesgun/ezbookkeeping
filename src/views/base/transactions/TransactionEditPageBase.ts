import { ref, computed, watch } from 'vue';

import { useI18n } from '@/locales/helpers.ts';

import { useSettingsStore } from '@/stores/setting.ts';
import { useUserStore } from '@/stores/user.ts';
import { useAccountsStore } from '@/stores/account.ts';
import { useTransactionCategoriesStore } from '@/stores/transactionCategory.ts';
import { useTransactionTagsStore } from '@/stores/transactionTag.ts';
import { useTransactionsStore } from '@/stores/transaction.ts';
import { useExchangeRatesStore } from '@/stores/exchangeRates.ts';

import type { NumeralSystem } from '@/core/numeral.ts';
import type { WeekDayValue } from '@/core/datetime.ts';
import type { LocalizedTimezoneInfo } from '@/core/timezone.ts';
import { TransactionType, TransactionQuickAddButtonActionType } from '@/core/transaction.ts';
import { TemplateType } from '@/core/template.ts';
import { DISPLAY_HIDDEN_AMOUNT } from '@/consts/numeral.ts';
import { TRANSACTION_MAX_PICTURE_COUNT } from '@/consts/transaction.ts';

import { Account, type CategorizedAccountWithDisplayBalance } from '@/models/account.ts';
import type { TransactionCategory } from '@/models/transaction_category.ts';
import type { TransactionTag } from '@/models/transaction_tag.ts';
import type { TransactionPictureInfoBasicResponse } from '@/models/transaction_picture_info.ts';
import { Transaction } from '@/models/transaction.ts';
import { TransactionTemplate } from '@/models/transaction_template.ts';
import type { LocalizedCurrencyInfo } from '@/core/currency.ts';

import {
    isArray,
    isDefined
} from '@/lib/common.ts';

import {
    getExchangedAmountByRate
} from '@/lib/numeral.ts';

import {
    getUtcOffsetByUtcOffsetMinutes,
    getTimezoneOffsetMinutes,
    getSameDateTimeWithCurrentTimezone,
    parseDateTimeFromUnixTimeWithBrowserTimezone,
    getCurrentUnixTime
} from '@/lib/datetime.ts';

import {
    type SetTransactionOptions,
    setTransactionModelByTransaction
} from '@/lib/transaction.ts';

export enum TransactionEditPageType {
    Transaction = 'transaction',
    Template = 'template'
}

export enum TransactionEditPageMode {
    Add = 'add',
    Edit = 'edit',
    View = 'view'
}

export enum GeoLocationStatus {
    Getting = 'getting',
    Success = 'success',
    Error = 'error'
}

export enum AfterSaveAction {
    GoBack = 'goBack',
    StayWithNewTransaction = 'stayWithNewTransaction',
    StayWithCurrentTransaction = 'stayWithCurrentTransaction'
}

export interface ExpenseCurrencyPickerItem {
    readonly currencyCode: string,
    readonly displayName: string,
    readonly secondaryText: string,
    readonly disabled: boolean
}

const recentExpenseForeignCurrenciesLocalStorageKey = 'ebk_recent_expense_foreign_currencies';

function getRecentExpenseForeignCurrenciesFromLocalStorage(): string[] {
    const storageData = localStorage.getItem(recentExpenseForeignCurrenciesLocalStorageKey) || '[]';

    try {
        const parsedData = JSON.parse(storageData);

        return isArray(parsedData)
            ? parsedData.filter(currency => typeof currency === 'string')
            : [];
    } catch {
        return [];
    }
}

function setRecentExpenseForeignCurrenciesToLocalStorage(currencies: string[]): void {
    localStorage.setItem(recentExpenseForeignCurrenciesLocalStorageKey, JSON.stringify(currencies));
}

export function useTransactionEditPageBase(type: TransactionEditPageType, initMode?: TransactionEditPageMode, transactionDefaultType?: number) {
    const {
        tt,
        getAllCurrencies,
        getAllTimezones,
        getCurrentNumeralSystemType,
        getTimezoneDifferenceDisplayText,
        formatAmountToLocalizedNumeralsWithCurrency,
        formatExchangeRateAmountToWesternArabicNumerals,
        getAdaptiveAmountRate,
        getCategorizedAccountsWithDisplayBalance
    } = useI18n();

    const settingsStore = useSettingsStore();
    const userStore = useUserStore();
    const accountsStore = useAccountsStore();
    const transactionCategoriesStore = useTransactionCategoriesStore();
    const transactionTagsStore = useTransactionTagsStore();
    const transactionsStore = useTransactionsStore();
    const exchangeRatesStore = useExchangeRatesStore();

    const isSupportGeoLocation: boolean = !!navigator.geolocation;

    const mode = ref<TransactionEditPageMode>(initMode ?? TransactionEditPageMode.Add);
    const editId = ref<string | null>(null);
    const addByTemplateId = ref<string | null>(null);
    const duplicateFromId = ref<string | null>(null);

    const clientSessionId = ref<string>('');
    const loading = ref<boolean>(true);
    const submitting = ref<boolean>(false);
    const submitted = ref<boolean>(false);
    const uploadingPicture = ref<boolean>(false);
    const geoLocationStatus = ref<GeoLocationStatus | null>(null);
    const setGeoLocationByClickMap = ref<boolean>(false);
    const expenseAmountInputMode = ref<'account' | 'foreign'>('account');
    const expenseForeignCurrency = ref<string>('');
    const expenseForeignAmount = ref<number>(0);
    const recentExpenseForeignCurrencies = ref<string[]>(getRecentExpenseForeignCurrenciesFromLocalStorage().slice(0, 3));

    const transaction = ref<Transaction | TransactionTemplate>(createNewTransactionModel(transactionDefaultType));

    const numeralSystem = computed<NumeralSystem>(() => getCurrentNumeralSystemType());
    const currentTimezoneOffsetMinutes = computed<number>(() => getTimezoneOffsetMinutes(transaction.value.time));
    const showAccountBalance = computed<boolean>(() => settingsStore.appSettings.showAccountBalance);
    const customAccountCategoryOrder = computed<string>(() => settingsStore.appSettings.accountCategoryOrders);
    const defaultCurrency = computed<string>(() => userStore.currentUserDefaultCurrency);
    const defaultAccountId = computed<string>(() => userStore.currentUserDefaultAccountId);
    const firstDayOfWeek = computed<WeekDayValue>(() => userStore.currentUserFirstDayOfWeek);
    const coordinateDisplayType = computed<number>(() => userStore.currentUserCoordinateDisplayType);

    const allTimezones = computed<LocalizedTimezoneInfo[]>(() => {
        if (type === TransactionEditPageType.Template && transaction.value instanceof TransactionTemplate) {
            return getAllTimezones(getCurrentUnixTime(), true);
        } else {
            return getAllTimezones(transaction.value.time, true)
        }
    });
    const allAccounts = computed<Account[]>(() => accountsStore.allPlainAccounts);
    const allVisibleAccounts = computed<Account[]>(() => accountsStore.allVisiblePlainAccounts);
    const allAccountsMap = computed<Record<string, Account>>(() => accountsStore.allAccountsMap);
    const allVisibleCategorizedAccounts = computed<CategorizedAccountWithDisplayBalance[]>(() => getCategorizedAccountsWithDisplayBalance(allVisibleAccounts.value, showAccountBalance.value, customAccountCategoryOrder.value));
    const allCurrencies = computed<LocalizedCurrencyInfo[]>(() => getAllCurrencies());
    const allCategories = computed<Record<number, TransactionCategory[]>>(() => transactionCategoriesStore.allTransactionCategories);
    const allCategoriesMap = computed<Record<string, TransactionCategory>>(() => transactionCategoriesStore.allTransactionCategoriesMap);
    const allTagsMap = computed<Record<string, TransactionTag>>(() => transactionTagsStore.allTransactionTagsMap);
    const firstVisibleAccountId = computed<string | undefined>(() => allVisibleAccounts.value && allVisibleAccounts.value[0] ? allVisibleAccounts.value[0].id : undefined);

    const hasVisibleExpenseCategories = computed<boolean>(() => transactionCategoriesStore.hasVisibleExpenseCategories);
    const hasVisibleIncomeCategories = computed<boolean>(() => transactionCategoriesStore.hasVisibleIncomeCategories);
    const hasVisibleTransferCategories = computed<boolean>(() => transactionCategoriesStore.hasVisibleTransferCategories);

    const canAddTransactionPicture = computed<boolean>(() => {
        if (type !== TransactionEditPageType.Transaction || (mode.value !== TransactionEditPageMode.Add && mode.value !== TransactionEditPageMode.Edit)) {
            return false;
        }

        return !isArray(transaction.value.pictures) || transaction.value.pictures.length < TRANSACTION_MAX_PICTURE_COUNT;
    });

    const title = computed<string>(() => {
        if (type === TransactionEditPageType.Transaction) {
            if (mode.value === TransactionEditPageMode.Add) {
                return 'Add Transaction';
            } else if (mode.value === TransactionEditPageMode.Edit) {
                return 'Edit Transaction';
            } else {
                return 'Transaction Detail';
            }
        } else if (type === TransactionEditPageType.Template && (transaction.value as TransactionTemplate).templateType === TemplateType.Normal.type) {
            if (mode.value === TransactionEditPageMode.Add) {
                return 'Add Transaction Template';
            } else if (mode.value === TransactionEditPageMode.Edit) {
                return 'Edit Transaction Template';
            }
        } else if (type === TransactionEditPageType.Template && (transaction.value as TransactionTemplate).templateType === TemplateType.Schedule.type) {
            if (mode.value === TransactionEditPageMode.Add) {
                return 'Add Scheduled Transaction';
            } else if (mode.value === TransactionEditPageMode.Edit) {
                return 'Edit Scheduled Transaction';
            }
        }

        return '';
    });

    const saveButtonTitle = computed<string>(() => {
        if (mode.value === TransactionEditPageMode.Add) {
            return 'Add';
        } else {
            return 'Save';
        }
    });

    const quickSaveButtonTitle = computed<string>(() => {
        if (mode.value === TransactionEditPageMode.Add) {
            const quickAddActionType = TransactionQuickAddButtonActionType.valueOf(settingsStore.appSettings.quickAddButtonActionInMobileTransactionEditPage);

            if (quickAddActionType && quickAddActionType.type !== TransactionQuickAddButtonActionType.OpenMenu.type) {
                return quickAddActionType.name;
            } else {
                return 'Add';
            }
        } else {
            return 'Save';
        }
    });

    const cancelButtonTitle = computed<string>(() => {
        if (mode.value === TransactionEditPageMode.View) {
            return 'Close';
        } else {
            return 'Cancel';
        }
    });

    const sourceAmountName = computed<string>(() => {
        if (transaction.value.type === TransactionType.Expense) {
            return 'Expense Amount';
        } else if (transaction.value.type === TransactionType.Income) {
            return 'Income Amount';
        } else if (transaction.value.type === TransactionType.Transfer) {
            return 'Transfer Out Amount';
        } else {
            return 'Amount';
        }
    });

    const sourceAmountTitle = computed<string>(() => {
        const amountName = tt(sourceAmountName.value);

        if (!currentSourceAccount.value || currentSourceAccount.value.currency === defaultCurrency.value || !transaction.value.sourceAmount || transaction.value.hideAmount) {
            return amountName;
        }

        const fromExchangeRate = exchangeRatesStore.latestExchangeRateMap[currentSourceAccount.value.currency];
        const toExchangeRate = exchangeRatesStore.latestExchangeRateMap[defaultCurrency.value];

        if (!fromExchangeRate || !fromExchangeRate.rate || !toExchangeRate || !toExchangeRate.rate) {
            return amountName;
        }

        let amountInDefaultCurrency = getExchangedAmountByRate(transaction.value.sourceAmount, fromExchangeRate.rate, toExchangeRate.rate);

        if (!amountInDefaultCurrency) {
            return amountName;
        }

        amountInDefaultCurrency = Math.trunc(amountInDefaultCurrency);

        const displayAmountInDefaultCurrency = getDisplayAmount(amountInDefaultCurrency, transaction.value.hideAmount, defaultCurrency.value);
        return amountName + ` (${displayAmountInDefaultCurrency})`;
    });

    const sourceAccountTitle = computed<string>(() => {
        if (transaction.value.type === TransactionType.Expense || transaction.value.type === TransactionType.Income) {
            return 'Account';
        } else if (transaction.value.type === TransactionType.Transfer) {
            return 'Source Account';
        } else {
            return 'Account';
        }
    });

    const transferInAmountTitle = computed<string>(() => {
        const sourceAccount = allAccountsMap.value[transaction.value.sourceAccountId];
        const destinationAccount = allAccountsMap.value[transaction.value.destinationAccountId];

        if (!sourceAccount || !destinationAccount || sourceAccount.currency === destinationAccount.currency) {
            return tt('Transfer In Amount');
        }

        const fromExchangeRate = exchangeRatesStore.latestExchangeRateMap[sourceAccount.currency];
        const toExchangeRate = exchangeRatesStore.latestExchangeRateMap[destinationAccount.currency];
        const amountRate = getAdaptiveAmountRate(transaction.value.sourceAmount, transaction.value.destinationAmount, fromExchangeRate, toExchangeRate);

        if (!amountRate) {
            return tt('Transfer In Amount');
        }

        return tt('Transfer In Amount') + ` (${amountRate})`;
    });

    const sourceAccountName = computed<string>(() => {
        if (transaction.value.sourceAccountId) {
            return Account.findAccountNameById(allAccounts.value, transaction.value.sourceAccountId) || '';
        } else {
            return tt('None');
        }
    });

    const destinationAccountName = computed<string>(() => {
        if (transaction.value.destinationAccountId) {
            return Account.findAccountNameById(allAccounts.value, transaction.value.destinationAccountId) || '';
        } else {
            return tt('None');
        }
    });

    const sourceAccountCurrency = computed<string>(() => {
        if (currentSourceAccount.value) {
            return currentSourceAccount.value.currency;
        }

        return defaultCurrency.value;
    });

    const currentSourceAccount = computed<Account | undefined>(() => allAccountsMap.value[transaction.value.sourceAccountId]);
    const selectableExpenseForeignCurrencies = computed<LocalizedCurrencyInfo[]>(() => {
        const currenciesByCode: Record<string, LocalizedCurrencyInfo> = {};

        for (const currency of allCurrencies.value) {
            if (currency.currencyCode !== sourceAccountCurrency.value) {
                currenciesByCode[currency.currencyCode] = currency;
            }
        }

        const recentCurrencies: LocalizedCurrencyInfo[] = [];
        const orderedCurrencies: LocalizedCurrencyInfo[] = [];

        for (const currencyCode of recentExpenseForeignCurrencies.value) {
            const currency = currenciesByCode[currencyCode];

            if (currency) {
                recentCurrencies.push(currency);
                delete currenciesByCode[currencyCode];
            }
        }

        for (const currency of allCurrencies.value) {
            if (currenciesByCode[currency.currencyCode]) {
                orderedCurrencies.push(currency);
            }
        }

        return recentCurrencies.concat(orderedCurrencies);
    });
    const expenseCurrencyPickerItems = computed<ExpenseCurrencyPickerItem[]>(() => {
        const sourceCurrency = sourceAccountCurrency.value;
        const sourceExchangeRate = exchangeRatesStore.latestExchangeRateMap[sourceCurrency];
        const sourceCurrencyInfo = allCurrencies.value.find(currency => currency.currencyCode === sourceCurrency);
        const sourceCurrencyDisplayName = sourceCurrencyInfo?.displayName || sourceCurrency;
        const items: ExpenseCurrencyPickerItem[] = [{
            currencyCode: sourceCurrency,
            displayName: sourceCurrencyDisplayName,
            secondaryText: tt('Use account currency'),
            disabled: false
        }];

        for (const currency of selectableExpenseForeignCurrencies.value) {
            const foreignExchangeRate = exchangeRatesStore.latestExchangeRateMap[currency.currencyCode];
            const convertedRate = sourceExchangeRate?.rate && foreignExchangeRate?.rate
                ? getExchangedAmountByRate(1, foreignExchangeRate.rate, sourceExchangeRate.rate)
                : null;
            const hasExchangeRate = convertedRate !== null;
            const displayRate = hasExchangeRate
                ? formatExchangeRateAmountToWesternArabicNumerals(convertedRate)
                : null;

            items.push({
                currencyCode: currency.currencyCode,
                displayName: currency.displayName,
                secondaryText: hasExchangeRate
                    ? `${currency.currencyCode} • 1 ${currency.currencyCode} = ${displayRate} ${sourceCurrency}`
                    : tt('No exchange rate data'),
                disabled: !hasExchangeRate
            });
        }

        return items;
    });
    const expenseForeignAmountExchangeRateMissing = computed<boolean>(() => {
        if (transaction.value.type !== TransactionType.Expense || expenseAmountInputMode.value !== 'foreign') {
            return false;
        }

        if (!expenseForeignCurrency.value || !sourceAccountCurrency.value) {
            return true;
        }

        return exchangeRatesStore.getExchangedAmount(1, expenseForeignCurrency.value, sourceAccountCurrency.value) === null;
    });
    const convertedExpenseSourceAmount = computed<number | null>(() => {
        if (transaction.value.type !== TransactionType.Expense || expenseAmountInputMode.value !== 'foreign') {
            return null;
        }

        const convertedAmount = exchangeRatesStore.getExchangedAmount(expenseForeignAmount.value, expenseForeignCurrency.value, sourceAccountCurrency.value);

        if (convertedAmount === null) {
            return null;
        }

        return Math.trunc(convertedAmount);
    });
    const shouldShowExpenseForeignAmountFields = computed<boolean>(() => {
        return transaction.value.type === TransactionType.Expense && expenseAmountInputMode.value === 'foreign';
    });
    const convertedExpenseSourceAmountHelperText = computed<string | null>(() => {
        if (!shouldShowExpenseForeignAmountFields.value || convertedExpenseSourceAmount.value === null) {
            return null;
        }

        return `${tt('Converted to')} ${sourceAccountCurrency.value}: ${getDisplayAmount(convertedExpenseSourceAmount.value, transaction.value.hideAmount, sourceAccountCurrency.value)}`;
    });
    const expenseAmountInputProblemMessage = computed<string | null>(() => {
        if (expenseForeignAmountExchangeRateMissing.value) {
            return 'Missing exchange rate data';
        }

        return null;
    });
    const editedExpenseAmount = computed<number>({
        get: () => {
            if (transaction.value.type === TransactionType.Expense && expenseAmountInputMode.value === 'foreign') {
                return expenseForeignAmount.value;
            }

            return transaction.value.sourceAmount;
        },
        set: (value: number) => {
            if (transaction.value.type === TransactionType.Expense && expenseAmountInputMode.value === 'foreign') {
                expenseForeignAmount.value = value;
            } else {
                transaction.value.sourceAmount = value;
            }
        }
    });

    const destinationAccountCurrency = computed<string>(() => {
        const destinationAccount = allAccountsMap.value[transaction.value.destinationAccountId];

        if (destinationAccount) {
            return destinationAccount.currency;
        }

        return defaultCurrency.value;
    });

    const transactionDisplayTimezone = computed<string>(() => {
        const utcOffset = numeralSystem.value.replaceWesternArabicDigitsToLocalizedDigits(getUtcOffsetByUtcOffsetMinutes(transaction.value.utcOffset));
        return `UTC${utcOffset}`;
    });

    const transactionTimezoneTimeDifference = computed<string>(() => {
        return getTimezoneDifferenceDisplayText(transaction.value.time, transaction.value.utcOffset);
    });

    const geoLocationStatusInfo = computed<string>(() => {
        if (geoLocationStatus.value === GeoLocationStatus.Success) {
            return '';
        } else if (geoLocationStatus.value === GeoLocationStatus.Getting) {
            return tt('Getting Location...');
        } else {
            return tt('No Location');
        }
    });

    const inputEmptyProblemMessage = computed<string | null>(() => {
        const expenseAmountProblemMessage = expenseAmountInputProblemMessage.value;

        if (expenseAmountProblemMessage) {
            return expenseAmountProblemMessage;
        }

        if (transaction.value.type === TransactionType.Expense) {
            if (!transaction.value.expenseCategoryId || transaction.value.expenseCategoryId === '') {
                return 'Transaction category cannot be blank';
            }

            if (!transaction.value.sourceAccountId || transaction.value.sourceAccountId === '') {
                return 'Transaction account cannot be blank';
            }
        } else if (transaction.value.type === TransactionType.Income) {
            if (!transaction.value.incomeCategoryId || transaction.value.incomeCategoryId === '') {
                return 'Transaction category cannot be blank';
            }

            if (!transaction.value.sourceAccountId || transaction.value.sourceAccountId === '') {
                return 'Transaction account cannot be blank';
            }
        } else if (transaction.value.type === TransactionType.Transfer) {
            if (!transaction.value.transferCategoryId || transaction.value.transferCategoryId === '') {
                return 'Transaction category cannot be blank';
            }

            if (!transaction.value.sourceAccountId || transaction.value.sourceAccountId === '') {
                return 'Source account cannot be blank';
            }

            if (!transaction.value.destinationAccountId || transaction.value.destinationAccountId === '') {
                return 'Destination account cannot be blank';
            }
        }

        if (type === TransactionEditPageType.Template && transaction.value instanceof TransactionTemplate) {
            if (!transaction.value.name) {
                return 'Template name cannot be blank';
            }
        }

        return null;
    });

    const inputIsEmpty = computed<boolean>(() => {
        return !!inputEmptyProblemMessage.value;
    });

    function getCurrentUnixTimeForNewTransaction(): number {
        return getSameDateTimeWithCurrentTimezone(parseDateTimeFromUnixTimeWithBrowserTimezone(getCurrentUnixTime())).getUnixTime();
    }

    function createNewTransactionModel(transactionType?: number): Transaction | TransactionTemplate {
        const now: number = getCurrentUnixTimeForNewTransaction();
        const currentTimezone: string = settingsStore.appSettings.timeZone;

        let defaultType: TransactionType = TransactionType.Expense;

        if (transactionType === TransactionType.Income) {
            defaultType = TransactionType.Income;
        } else if (transactionType === TransactionType.Transfer) {
            defaultType = TransactionType.Transfer;
        }

        let newTransaction: Transaction | TransactionTemplate = Transaction.createNewTransaction(defaultType, now, currentTimezone, getTimezoneOffsetMinutes(now, currentTimezone));

        if (type === TransactionEditPageType.Template) {
            newTransaction = TransactionTemplate.createNewTransactionTemplate(newTransaction);
        }

        return newTransaction;
    }

    function setTransactionModel(newTransaction: Transaction | null, options: SetTransactionOptions | undefined, setContextData: boolean): void {
        resetExpenseForeignAmountState();

        setTransactionModelByTransaction(
            transaction.value,
            newTransaction,
            allCategories.value,
            allCategoriesMap.value,
            allVisibleAccounts.value,
            allAccountsMap.value,
            allTagsMap.value,
            defaultAccountId.value,
            {
                time: options?.time,
                type: options?.type,
                categoryId: options?.categoryId,
                accountId: options?.accountId,
                destinationAccountId: options?.destinationAccountId,
                amount: options?.amount,
                destinationAmount: options?.destinationAmount,
                tagIds: options?.tagIds,
                comment: options?.comment
            },
            setContextData
        );

    }

    function resetExpenseForeignAmountState(): void {
        expenseAmountInputMode.value = 'account';
        expenseForeignCurrency.value = '';
        expenseForeignAmount.value = 0;
    }

    function rememberExpenseForeignCurrency(currency: string): void {
        const newCurrencies = [currency]
            .concat(recentExpenseForeignCurrencies.value.filter(item => item !== currency))
            .slice(0, 3);

        recentExpenseForeignCurrencies.value = newCurrencies;
        setRecentExpenseForeignCurrenciesToLocalStorage(newCurrencies);
    }

    function tryEnableExpenseForeignAmount(currency: string, showMessage: ((message: string) => void) | undefined): boolean {
        if (transaction.value.type !== TransactionType.Expense) {
            resetExpenseForeignAmountState();
            return false;
        }

        if (!currency || currency === sourceAccountCurrency.value) {
            resetExpenseForeignAmountState();
            return false;
        }

        if (exchangeRatesStore.getExchangedAmount(1, currency, sourceAccountCurrency.value) === null) {
            showMessage?.('Missing exchange rate data');
            resetExpenseForeignAmountState();
            return false;
        }

        expenseAmountInputMode.value = 'foreign';
        expenseForeignCurrency.value = currency;

        const convertedAmount = exchangeRatesStore.getExchangedAmount(transaction.value.sourceAmount, sourceAccountCurrency.value, currency);
        expenseForeignAmount.value = convertedAmount !== null ? convertedAmount : transaction.value.sourceAmount;

        return true;
    }

    function finalizeExpenseForeignAmountSave(): void {
        if (transaction.value.type === TransactionType.Expense && expenseAmountInputMode.value === 'foreign' && expenseForeignCurrency.value) {
            rememberExpenseForeignCurrency(expenseForeignCurrency.value);
        }
    }

    function updateTransactionModelByAfterSaveAction(afterSaveAction: AfterSaveAction, initOptions?: SetTransactionOptions): void {
        if (afterSaveAction === AfterSaveAction.StayWithNewTransaction) {
            transaction.value = createNewTransactionModel(transactionDefaultType);
            setTransactionModel(null, initOptions, true);
            geoLocationStatus.value = null;
        } else if (afterSaveAction === AfterSaveAction.StayWithCurrentTransaction) {
            transaction.value.clearPictures();
        }
    }

    function updateTransactionTime(newTime: number): void {
        transaction.value.time = newTime;
        updateTransactionTimezone(transaction.value.timeZone ?? '');
    }

    function updateTransactionTimezone(timezoneName: string): void {
        const oldUtcOffset = transaction.value.utcOffset;

        for (const timezone of allTimezones.value) {
            if (timezone.name === timezoneName) {
                transaction.value.timeZone = timezone.name;
                transaction.value.utcOffset = timezone.utcOffsetMinutes;
                break;
            }
        }

        transaction.value.time = transaction.value.time - (transaction.value.utcOffset - oldUtcOffset) * 60;
    }

    function swapTransactionData(swapAccount: boolean, swapAmount: boolean): void {
        if (swapAccount) {
            const oldSourceAccountId = transaction.value.sourceAccountId;
            transaction.value.sourceAccountId = transaction.value.destinationAccountId;
            transaction.value.destinationAccountId = oldSourceAccountId;
        }

        if (swapAmount) {
            const oldSourceAmount = transaction.value.sourceAmount;
            transaction.value.sourceAmount = transaction.value.destinationAmount;
            transaction.value.destinationAmount = oldSourceAmount;
        }
    }

    function getDisplayAmount(amount: number, hideAmount: boolean, currencyCode: string): string {
        if (hideAmount) {
            return formatAmountToLocalizedNumeralsWithCurrency(DISPLAY_HIDDEN_AMOUNT, currencyCode);
        }

        return formatAmountToLocalizedNumeralsWithCurrency(amount, currencyCode);
    }

    function getTransactionPictureUrl(pictureInfo?: TransactionPictureInfoBasicResponse | null): string | undefined {
        return transactionsStore.getTransactionPictureUrl(pictureInfo);
    }

    watch(() => transaction.value.sourceAmount, (newValue, oldValue) => {
        if (mode.value === TransactionEditPageMode.View || loading.value) {
            return;
        }

        transactionsStore.setTransactionSuitableDestinationAmount(transaction.value, oldValue, newValue);
    });

    watch(() => transaction.value.type, (newType) => {
        if (newType !== TransactionType.Expense) {
            resetExpenseForeignAmountState();
        }
    });

    watch(() => sourceAccountCurrency.value, (newCurrency) => {
        if (expenseAmountInputMode.value !== 'foreign') {
            return;
        }

        if (!expenseForeignCurrency.value || expenseForeignCurrency.value === newCurrency) {
            resetExpenseForeignAmountState();
        }
    });

    watch(() => expenseForeignCurrency.value, (newCurrency) => {
        if (expenseAmountInputMode.value !== 'foreign') {
            return;
        }

        if (!newCurrency || newCurrency === sourceAccountCurrency.value) {
            resetExpenseForeignAmountState();
        }
    });

    watch(() => convertedExpenseSourceAmount.value, (convertedAmount) => {
        if (expenseAmountInputMode.value !== 'foreign' || transaction.value.type !== TransactionType.Expense) {
            return;
        }

        if (convertedAmount !== null) {
            transaction.value.sourceAmount = convertedAmount;
        }
    }, {
        immediate: true
    });

    watch(() => transaction.value.destinationAmount, (newValue) => {
        if (mode.value === TransactionEditPageMode.View || loading.value) {
            return;
        }

        if (transaction.value.type === TransactionType.Expense || transaction.value.type === TransactionType.Income) {
            transaction.value.sourceAmount = newValue;
        }
    });

    // Watch for account changes and recalculate destination amount for transfers
    watch(() => [transaction.value.sourceAccountId, transaction.value.destinationAccountId], ([newSourceAccountId, newDestinationAccountId], [oldSourceAccountId, oldDestinationAccountId]) => {
        if (mode.value === TransactionEditPageMode.View || loading.value) {
            return;
        }

        if (transaction.value.type !== TransactionType.Transfer) {
            return;
        }

        // Only recalculate if accounts actually changed (skip initial watch call)
        if (isDefined(oldSourceAccountId) && isDefined(oldDestinationAccountId)) {
            if (newSourceAccountId === oldSourceAccountId && newDestinationAccountId === oldDestinationAccountId) {
                return;
            }
        }

        transactionsStore.setTransactionSuitableDestinationAmount(transaction.value, transaction.value.sourceAmount, transaction.value.sourceAmount, oldSourceAccountId, oldDestinationAccountId);
    });

    return {
        // constants
        isSupportGeoLocation,
        // states
        mode,
        editId,
        addByTemplateId,
        duplicateFromId,
        clientSessionId,
        loading,
        submitting,
        submitted,
        uploadingPicture,
        geoLocationStatus,
        setGeoLocationByClickMap,
        expenseAmountInputMode,
        expenseForeignCurrency,
        expenseForeignAmount,
        recentExpenseForeignCurrencies,
        transaction,
        // computed states
        numeralSystem,
        currentTimezoneOffsetMinutes,
        showAccountBalance,
        defaultCurrency,
        defaultAccountId,
        firstDayOfWeek,
        coordinateDisplayType,
        allTimezones,
        allAccounts,
        allVisibleAccounts,
        allAccountsMap,
        allVisibleCategorizedAccounts,
        allCurrencies,
        allCategories,
        allCategoriesMap,
        allTagsMap,
        firstVisibleAccountId,
        hasVisibleExpenseCategories,
        hasVisibleIncomeCategories,
        hasVisibleTransferCategories,
        canAddTransactionPicture,
        title,
        saveButtonTitle,
        quickSaveButtonTitle,
        cancelButtonTitle,
        sourceAmountName,
        sourceAmountTitle,
        sourceAccountTitle,
        transferInAmountTitle,
        sourceAccountName,
        destinationAccountName,
        sourceAccountCurrency,
        currentSourceAccount,
        selectableExpenseForeignCurrencies,
        expenseCurrencyPickerItems,
        convertedExpenseSourceAmount,
        convertedExpenseSourceAmountHelperText,
        shouldShowExpenseForeignAmountFields,
        expenseAmountInputProblemMessage,
        editedExpenseAmount,
        destinationAccountCurrency,
        transactionDisplayTimezone,
        transactionTimezoneTimeDifference,
        geoLocationStatusInfo,
        inputEmptyProblemMessage,
        inputIsEmpty,
        // functions
        createNewTransactionModel,
        setTransactionModel,
        resetExpenseForeignAmountState,
        tryEnableExpenseForeignAmount,
        rememberExpenseForeignCurrency,
        finalizeExpenseForeignAmountSave,
        updateTransactionModelByAfterSaveAction,
        updateTransactionTime,
        updateTransactionTimezone,
        swapTransactionData,
        getDisplayAmount,
        getTransactionPictureUrl
    }
}
