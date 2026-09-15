package main

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"sort"
	"strings"
)

var version = "dev"

// defaultCommand runs when no command is given.
var defaultCommand = "desktop"

// commands holds subcommands contributed by other files in this package.
var commands = map[string]func(configPath string) error{}

func main() {
	if err := run(os.Args[1:]); err != nil {
		slog.Error("rowset stopped", "error", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	command, configPath, err := parseArgs(args)
	if err != nil {
		return err
	}
	if configPath != "" {
		if err := os.Setenv("ROWSET_CONFIG", configPath); err != nil {
			return err
		}
	}
	switch command {
	case "--version", "-V", "version":
		fmt.Printf("rowset %s\n", version)
		return nil
	case "--help", "-h", "help":
		printHelp()
		return nil
	case "desktop":
		return desktop()
	case "desktop-stop":
		return stopDesktop()
	}
	if handler, ok := commands[command]; ok {
		return handler(configPath)
	}
	return fmt.Errorf("unknown command %q; run rowset --help", command)
}

func parseArgs(args []string) (string, string, error) {
	command, configPath := defaultCommand, ""
	commandSet := false
	for index := 0; index < len(args); index++ {
		argument := args[index]
		switch {
		case argument == "--config":
			index++
			if index >= len(args) || strings.TrimSpace(args[index]) == "" {
				return "", "", errors.New("--config requires a path")
			}
			configPath = args[index]
		case strings.HasPrefix(argument, "--config="):
			configPath = strings.TrimPrefix(argument, "--config=")
			if strings.TrimSpace(configPath) == "" {
				return "", "", errors.New("--config requires a path")
			}
		case !commandSet:
			command, commandSet = argument, true
		default:
			return "", "", fmt.Errorf("unexpected argument %q", argument)
		}
	}
	return command, configPath, nil
}

func printHelp() {
	fmt.Printf("rowset %s\n\nUSAGE:\n  rowset desktop        start and open Rowset Studio\n  rowset desktop-stop   stop the running Rowset Studio\n  rowset --version\n", version)
	if len(commands) > 0 {
		names := make([]string, 0, len(commands))
		for name := range commands {
			names = append(names, name)
		}
		sort.Strings(names)
		fmt.Printf("\nAlso: %s (default: %s)\n", strings.Join(names, ", "), defaultCommand)
	}
}
