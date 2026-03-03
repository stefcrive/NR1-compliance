type DbLikeError = {
  code?: string | null;
  message?: string | null;
};

function includes(value: string | null | undefined, snippet: string): boolean {
  if (!value) {
    return false;
  }
  return value.toLowerCase().includes(snippet.toLowerCase());
}

export function isMissingTableError(
  error: DbLikeError | null | undefined,
  tableName?: string,
): boolean {
  if (!error) {
    return false;
  }
  if (error.code === "42P01" || error.code === "PGRST205") {
    return true;
  }

  if (tableName) {
    return includes(error.message, tableName) && includes(error.message, "does not exist");
  }

  return includes(error.message, "could not find the table");
}

export function isMissingColumnError(
  error: DbLikeError | null | undefined,
  columnName?: string,
): boolean {
  if (!error) {
    return false;
  }
  if (error.code === "42703" || error.code === "PGRST204") {
    return true;
  }
  const message = error.message ?? "";
  const mentionsMissingColumn =
    includes(message, "column") && (includes(message, "does not exist") || includes(message, "could not find"));
  if (columnName) {
    return includes(message, columnName) && mentionsMissingColumn;
  }
  return mentionsMissingColumn;
}
