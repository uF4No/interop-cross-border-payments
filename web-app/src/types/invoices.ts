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
  adminAddress: string;
  counts: {
    created: number;
    pending: number;
    total: number;
  };
  createdInvoiceIds: string[];
  pendingInvoiceIds: string[];
  invoices: InvoiceRecord[];
};

export type InvoiceRecord = {
  id: string;
  creator: string;
  recipient: string;
  billingToken: string;
  amount: string;
  status: string;
  creatorChainId: number;
  recipientChainId: number;
  text: string;
};
