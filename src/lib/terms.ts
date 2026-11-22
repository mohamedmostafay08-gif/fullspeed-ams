export type Terms = {
  salary: string | null;
  order_price: string | null;
  working_hours: string | null;
  terms: { label: string; value: string }[] | null;
};

export const TERMS_COLUMNS = "salary, order_price, working_hours, terms";

export const hasTerms = (c: Partial<Terms>) => Boolean(c.salary || c.order_price || c.working_hours || c.terms?.length);
