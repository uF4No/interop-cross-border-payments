export const ACTIVE_CHAIN_BALANCES_REFRESH_EVENT = 'active-chain-balances-refresh-requested';
export const INVOICES_REFRESH_EVENT = 'invoices-refresh-requested';

const dispatchDashboardEvent = (eventName: string) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(eventName));
};

export const requestBalancesRefresh = () => {
  dispatchDashboardEvent(ACTIVE_CHAIN_BALANCES_REFRESH_EVENT);
};

export const requestInvoicesRefresh = () => {
  dispatchDashboardEvent(INVOICES_REFRESH_EVENT);
};
