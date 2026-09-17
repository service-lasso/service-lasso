import React from "react";
import clsx from "clsx";
import useIsBrowser from "@docusaurus/useIsBrowser";
import styles from "./styles.module.css";

export default function ColorModeToggle({ className, value, onChange }) {
  const isBrowser = useIsBrowser();
  return (
    <label className={clsx(styles.control, className)}>
      <span>Theme</span>
      <select
        aria-label="Theme"
        className={styles.select}
        value={isBrowser ? (value ?? "auto") : "auto"}
        disabled={!isBrowser}
        onChange={(event) =>
          onChange(event.target.value === "auto" ? null : event.target.value)
        }
      >
        <option value="auto">Auto</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
