# frozen_string_literal: true

require "json"
require "securerandom"
require "time"
require "fileutils"

module ReviewFlowTrace
  SCHEMA_VERSION = "reviewflow.rubyOracleTrace.v0.1"

  class Recorder
    attr_reader :events, :state_projections

    def initialize(name:, kind: "ruby-batch", output_file: ENV["REVIEWFLOW_LEGACY_TRACE_FILE"], input: {})
      @execution = {
        id: "legacy-exec-#{SecureRandom.hex(6)}",
        name: name,
        kind: kind,
        status: "running",
        startedAt: now,
        endedAt: nil,
        input: input
      }
      @output_file = output_file
      @events = []
      @state_projections = []
      event("execution.start", "#{name} started", input: input)
    end

    def event(type, label, details = {})
      item = {
        id: format("legacy.event.%04d", @events.length + 1),
        type: type,
        timestamp: now,
        label: label,
        details: sanitize(details)
      }
      @events << item
      item
    end

    def record_sql(sql, type: nil, rowcount: nil, details: {})
      operation = type || operation_for(sql)
      event(
        operation,
        "Oracle #{operation}",
        details.merge(sqlSummary: compact_sql(sql), tables: tables_for(sql), rowcount: rowcount)
      )
    end

    def projection(event_id:, table:, record:, field:, before:, patch:, after:, target: nil, certainty: "observed", source: {})
      item = {
        id: "legacy.#{table}.#{record}.#{field}.#{@state_projections.length + 1}",
        eventId: event_id,
        table: table,
        record: record,
        field: field,
        before: sanitize(before),
        patch: sanitize(patch),
        after: sanitize(after),
        certainty: certainty,
        target: sanitize(target),
        source: sanitize(source)
      }
      @state_projections << item
      item
    end

    def finish(status = "success")
      @execution[:status] = status
      @execution[:endedAt] = now
      event("execution.end", "#{@execution[:name]} ended", status: status)
      flush
    end

    def flush
      return unless @output_file

      FileUtils.mkdir_p(File.dirname(@output_file))
      File.write(@output_file, JSON.pretty_generate(to_h))
    end

    def to_h
      {
        schemaVersion: SCHEMA_VERSION,
        execution: @execution,
        events: @events,
        stateProjections: @state_projections
      }
    end

    private

    def now
      Time.now.utc.iso8601(3)
    end

    def compact_sql(sql)
      sql.to_s.split.join(" ")
    end

    def operation_for(sql)
      text = compact_sql(sql).downcase
      return "oracle.read" if text.start_with?("select", "with")
      return "oracle.write" if text.start_with?("insert", "update", "delete", "merge")
      return "transaction.commit" if text.start_with?("commit")
      return "transaction.rollback" if text.start_with?("rollback")

      "oracle.query"
    end

    def tables_for(sql)
      text = compact_sql(sql)
      patterns = [
        /\bfrom\s+([a-zA-Z_][\w.]*)/i,
        /\bjoin\s+([a-zA-Z_][\w.]*)/i,
        /\bupdate\s+([a-zA-Z_][\w.]*)/i,
        /\binsert\s+into\s+([a-zA-Z_][\w.]*)/i,
        /\bdelete\s+from\s+([a-zA-Z_][\w.]*)/i
      ]
      patterns.flat_map { |pattern| text.scan(pattern).flatten }.uniq
    end

    def sanitize(value)
      case value
      when Hash
        value.transform_values { |item| sanitize(item) }
      when Array
        { type: "Array", length: value.length }
      when String
        value.length > 120 ? "#{value[0, 117]}..." : value
      else
        value
      end
    end
  end

  def self.trace(name:, kind: "ruby-batch", input: {})
    recorder = Recorder.new(name: name, kind: kind, input: input)
    yield recorder
    recorder.finish("success")
  rescue StandardError => error
    recorder&.event("exception.throw", "#{error.class}: #{error.message}", backtrace: error.backtrace&.first(8))
    recorder&.finish("failed")
    raise
  end
end
