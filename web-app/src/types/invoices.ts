export type InvoiceSourceTag = 'created' | 'pending';
export type InvoiceView = 'all' | 'created' | 'received';
export type InvoiceTableRelationshipFilter = 'created' | 'received';
export type InvoiceTableStatusFilter = 'pending' | 'paid';

export type BackendServiceResponse<T> = {
  success: boolean;
  message: string;
  responseObject?: T;
  statusCode: number;
};

export type InvoiceResponseObject = {
  chain: {
    chainId: number;
    rpcUrl: string;
    apiUrl: string;
    authBaseUrl: string;
    invoicePayment: string;
  };
  accountAddress: string | null;
  adminAddress: string;
  counts: {
    created: number;
    pending: number;
    total: number;
  };
  view?: InvoiceView;
  availableViews?: InvoiceView[];
  countsByView?: Record<InvoiceView, number>;
  createdInvoiceIds: string[];
  pendingInvoiceIds: string[];
  invoices: InvoiceRecord[];
};

export type InvoiceRecord = {
  id: string;
  creator: string;
  recipient: string;
  creatorRefundAddress: string;
  recipientRefundAddress: string;
  billingToken: string;
  amount: string;
  paymentToken: string | null;
  paymentAmount: string;
  status: string;
  creatorChainId: number;
  recipientChainId: number;
  paidAt?: string | null;
  text: string;
  sourceTags: InvoiceSourceTag[];
};

export type InvoicePaymentOption = {
  token: string;
  symbol: 'USDC' | 'SGD' | 'TBILL' | string;
  paymentAmount: string;
  isBillingToken: boolean;
};

export type InvoicePaymentOptionsResponseObject = {
  invoiceId: string;
  status: string;
  billingToken: string;
  billingTokenSymbol: 'USDC' | 'SGD' | 'TBILL' | string;
  billingAmount: string;
  options: InvoicePaymentOption[];
  quoteType: 'exact';
  invoicePaymentBillingTokenBalance: string;
  hasSufficientBillingLiquidity: boolean;
};
