
/**
 * Utility functions for date and time formatting based on US standards.
 * Date Format: MM/DD/YYYY
 * Time Format: 12-hour with AM/PM
 * Timezone: (UTC-08:00) Pacific Time (US & Canada) - America/Los_Angeles
 */

const PACIFIC_TIMEZONE = 'America/Los_Angeles';

/**
 * Formats a date string or object to US standard date format (MM/DD/YYYY).
 * @param date - Date string (ISO or YYYY-MM-DD) or Date object.
 * @returns Formatted date string.
 */
export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '—';
  
  // If it's a YYYY-MM-DD string, handle it manually to avoid timezone shifts
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-');
    return `${month}/${day}/${year}`;
  }

  let d: Date;
  if (typeof date === 'string') {
    // If it looks like a SQLite timestamp (YYYY-MM-DD HH:MM:SS) without a timezone, append Z
    // SQLite's CURRENT_TIMESTAMP is UTC.
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) {
      d = new Date(date.replace(' ', 'T') + 'Z');
    } else {
      d = new Date(date);
    }
  } else {
    d = date;
  }

  if (isNaN(d.getTime())) return '—';
  
  // For Date objects or ISO strings, use Intl.DateTimeFormat with PACIFIC_TIMEZONE
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    timeZone: PACIFIC_TIMEZONE
  });
  return formatter.format(d);
}

/**
 * Formats a date string or object to US standard time format (12-hour with AM/PM).
 * @param date - Date string or Date object.
 * @returns Formatted time string.
 */
export function formatTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  
  let d: Date;
  if (typeof date === 'string') {
    // If it looks like a SQLite timestamp (YYYY-MM-DD HH:MM:SS) without a timezone, append Z
    // SQLite's CURRENT_TIMESTAMP is UTC.
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) {
      d = new Date(date.replace(' ', 'T') + 'Z');
    } else {
      d = new Date(date);
    }
  } else {
    d = date;
  }

  if (isNaN(d.getTime())) return '—';

  return d.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: PACIFIC_TIMEZONE
  });
}

/**
 * Formats a date string or object to US standard date and time format.
 * @param date - Date string or Date object.
 * @returns Formatted date and time string.
 */
export function formatDateTime(date: string | Date | null | undefined): string {
  if (!date) return '—';
  
  let d: Date;
  if (typeof date === 'string') {
    // If it looks like a SQLite timestamp (YYYY-MM-DD HH:MM:SS) without a timezone, append Z
    // SQLite's CURRENT_TIMESTAMP is UTC.
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date)) {
      d = new Date(date.replace(' ', 'T') + 'Z');
    } else {
      d = new Date(date);
    }
  } else {
    d = date;
  }

  if (isNaN(d.getTime())) return '—';

  return d.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: PACIFIC_TIMEZONE
  });
}

/**
 * Gets the current date/time in Pacific Time as a Date object.
 * This is useful for calculations (like getFullYear, getMonth) that should be consistent with Pacific Time.
 */
export function getPacificNow(): Date {
  const now = new Date();
  const pacificString = now.toLocaleString('en-US', { timeZone: PACIFIC_TIMEZONE });
  return new Date(pacificString);
}

/**
 * Gets the current date in US standard format.
 */
export function getCurrentDateUS(): string {
  return formatDate(new Date());
}

/**
 * Gets the current time in US standard format.
 */
export function getCurrentTimeUS(): string {
  return formatTime(new Date());
}

/**
 * Converts a date to YYYY-MM-DD format for use in date input fields.
 */
export function toInputDateFormat(date: string | Date | null | undefined): string {
  if (!date) return '';
  
  // If it's already a YYYY-MM-DD string, return it as is
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }

  const d = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(d.getTime())) return '';
  
  // We need to use the Pacific timezone to get the correct date components
  const formatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: PACIFIC_TIMEZONE
  });
  return formatter.format(d);
}
