package collector

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
	"github.com/shirou/gopsutil/v3/disk"
	"github.com/shirou/gopsutil/v3/mem"
	"github.com/shirou/gopsutil/v3/net"
)

type MetricSnapshot struct {
	Timestamp     time.Time `json:"timestamp"`
	CPUPercent    float64   `json:"cpu_percent"`
	MemoryPercent float64   `json:"memory_percent"`
	DiskPercent   float64   `json:"disk_percent"`
	NetBytesIn    uint64    `json:"net_bytes_in"`
	NetBytesOut   uint64    `json:"net_bytes_out"`
}

type LogEntry struct {
	Timestamp time.Time `json:"timestamp"`
	Level     string    `json:"level"`
	Source    string    `json:"source"`
	Message   string    `json:"message"`
}

type Collector struct {
	diskPath    string
	previousNet *net.IOCountersStat
	mu          sync.Mutex
}

func New() (*Collector, error) {
	network, err := readNetworkCounters()
	if err != nil {
		return nil, fmt.Errorf("read initial network counters: %w", err)
	}

	return &Collector{
		diskPath:    resolveDiskPath(),
		previousNet: network,
	}, nil
}

func (c *Collector) CollectMetric(ctx context.Context) (MetricSnapshot, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	cpuPercent, err := cpu.PercentWithContext(ctx, 0, false)
	if err != nil {
		return MetricSnapshot{}, fmt.Errorf("collect cpu: %w", err)
	}

	memory, err := mem.VirtualMemoryWithContext(ctx)
	if err != nil {
		return MetricSnapshot{}, fmt.Errorf("collect memory: %w", err)
	}

	diskUsage, err := disk.UsageWithContext(ctx, c.diskPath)
	if err != nil {
		return MetricSnapshot{}, fmt.Errorf("collect disk usage for %s: %w", c.diskPath, err)
	}

	currentNet, err := readNetworkCounters()
	if err != nil {
		return MetricSnapshot{}, fmt.Errorf("collect network: %w", err)
	}

	netBytesIn := delta(currentNet.BytesRecv, c.previousNet.BytesRecv)
	netBytesOut := delta(currentNet.BytesSent, c.previousNet.BytesSent)
	c.previousNet = currentNet

	cpuValue := 0.0
	if len(cpuPercent) > 0 {
		cpuValue = cpuPercent[0]
	}

	return MetricSnapshot{
		Timestamp:     time.Now().UTC(),
		CPUPercent:    cpuValue,
		MemoryPercent: memory.UsedPercent,
		DiskPercent:   diskUsage.UsedPercent,
		NetBytesIn:    netBytesIn,
		NetBytesOut:   netBytesOut,
	}, nil
}

func (c *Collector) CollectLogs(ctx context.Context) ([]LogEntry, error) {
	if runtime.GOOS == "windows" {
		return collectWindowsLogs(ctx)
	}
	return collectLinuxSyslog()
}

func resolveDiskPath() string {
	if runtime.GOOS == "windows" {
		systemDrive := os.Getenv("SystemDrive")
		if systemDrive == "" {
			return `C:\`
		}
		return systemDrive + `\`
	}
	return "/"
}

func readNetworkCounters() (*net.IOCountersStat, error) {
	counters, err := net.IOCounters(false)
	if err != nil {
		return nil, err
	}
	if len(counters) == 0 {
		return &net.IOCountersStat{}, nil
	}
	return &counters[0], nil
}

func delta(current, previous uint64) uint64 {
	if current < previous {
		return 0
	}
	return current - previous
}

func collectLinuxSyslog() ([]LogEntry, error) {
	file, err := os.Open("/var/log/syslog")
	if err != nil {
		if errorsIsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("open /var/log/syslog: %w", err)
	}
	defer file.Close()

	var lines []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
		if len(lines) > 50 {
			lines = lines[1:]
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("read /var/log/syslog: %w", err)
	}

	entries := make([]LogEntry, 0, len(lines))
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		entries = append(entries, LogEntry{
			Timestamp: time.Now().UTC(),
			Level:     inferLevel(line),
			Source:    "syslog",
			Message:   line,
		})
	}
	return entries, nil
}

func collectWindowsLogs(ctx context.Context) ([]LogEntry, error) {
	command := exec.CommandContext(
		ctx,
		"wevtutil",
		"qe",
		"Application",
		"/c:20",
		"/rd:true",
		"/f:text",
	)
	output, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("read Windows Application Event Log: %w", err)
	}
	return parseWindowsEventLog(output), nil
}

func parseWindowsEventLog(output []byte) []LogEntry {
	blocks := bytes.Split(output, []byte("\r\n\r\n"))
	if len(blocks) == 1 {
		blocks = bytes.Split(output, []byte("\n\n"))
	}

	entries := make([]LogEntry, 0, len(blocks))
	for _, block := range blocks {
		text := strings.TrimSpace(string(block))
		if text == "" {
			continue
		}
		entries = append(entries, parseWindowsEvent(text))
	}
	return entries
}

func parseWindowsEvent(text string) LogEntry {
	entry := LogEntry{
		Timestamp: time.Now().UTC(),
		Level:     "INFO",
		Source:    "windows-application",
		Message:   compactWhitespace(text),
	}

	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "Date:"):
			if parsed, err := parseWindowsEventTime(strings.TrimSpace(strings.TrimPrefix(line, "Date:"))); err == nil {
				entry.Timestamp = parsed
			}
		case strings.HasPrefix(line, "Level:"):
			entry.Level = normalizeWindowsLevel(strings.TrimSpace(strings.TrimPrefix(line, "Level:")))
		case strings.HasPrefix(line, "Provider Name:"):
			source := strings.TrimSpace(strings.TrimPrefix(line, "Provider Name:"))
			if source != "" {
				entry.Source = source
			}
		}
	}

	return entry
}

func parseWindowsEventTime(value string) (time.Time, error) {
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05.000000000Z07:00",
		"2006-01-02T15:04:05.000000000",
		"2006-01-02T15:04:05.0000000",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("unsupported Windows event time %q", value)
}

func normalizeWindowsLevel(level string) string {
	upper := strings.ToUpper(level)
	switch {
	case strings.Contains(upper, "CRITICAL"):
		return "CRITICAL"
	case strings.Contains(upper, "ERROR"):
		return "ERROR"
	case strings.Contains(upper, "WARN"):
		return "WARNING"
	case strings.Contains(upper, "DEBUG"):
		return "DEBUG"
	default:
		return "INFO"
	}
}

func inferLevel(message string) string {
	upper := strings.ToUpper(message)
	switch {
	case strings.Contains(upper, "CRITICAL") || strings.Contains(upper, "FATAL"):
		return "CRITICAL"
	case strings.Contains(upper, "ERROR") || strings.Contains(upper, "FAIL"):
		return "ERROR"
	case strings.Contains(upper, "WARN"):
		return "WARNING"
	case strings.Contains(upper, "DEBUG"):
		return "DEBUG"
	default:
		return "INFO"
	}
}

func compactWhitespace(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func errorsIsNotExist(err error) bool {
	return os.IsNotExist(err)
}

func (m MetricSnapshot) CPUPercentRounded() int {
	return int(m.CPUPercent + 0.5)
}

func ParseWindowsEventID(line string) int {
	fields := strings.Fields(line)
	if len(fields) == 0 {
		return 0
	}
	value, _ := strconv.Atoi(fields[len(fields)-1])
	return value
}
